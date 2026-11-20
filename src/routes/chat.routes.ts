import "dotenv/config";
import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import { desc } from "drizzle-orm";
import { db } from "../config/db";
import { redis } from "../config/redis";
import { projects } from "../db/schema";

const router = Router();

// Urutan prioritas model: Utama -> Cadangan Cepat -> Cadangan Kuota Besar
const MODEL_FALLBACK_CHAIN = [
    "gemini-4-hydrogen",
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
    "gemma-4-31b-it",
];

// Batasan maksimal 5 pesan per menit per IP
const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message:
            "Waduh, ngetiknya ngebut banget nih! Maksimal 5 pesan per menit ya, kasih napas dulu servernya hehe.",
    },
});

const ChatRequestSchema = z.object({
    message: z
        .string()
        .min(1, "Pesan tidak boleh kosong")
        .max(400, "Pesan kepanjangan, maksimal 400 karakter ya!"),
    history: z
        .array(
            z.object({
                role: z.enum(["user", "model"]),
                text: z.string(),
            })
        )
        .max(6)
        .optional(),
});

async function getProjectsContext(): Promise<string> {
    try {
        if (redis.status === "ready") {
            const cached = await redis.get("projects:all");
            if (cached) {
                const parsed = JSON.parse(cached);
                return formatProjectsForPrompt(parsed);
            }
        }

        const rows = await db
            .select()
            .from(projects)
            .orderBy(desc(projects.publishedAt));

        return formatProjectsForPrompt(rows);
    } catch (err) {
        console.error("[CHAT_DB_CONTEXT_ERROR]:", err);
        return "Data projek sedang tidak dapat diakses sementara.";
    }
}

function formatProjectsForPrompt(
    projectList: Array<{
        title: string;
        category: string;
        summary: string;
        description: string;
        tags: string[];
        githubUrl?: string | null;
        liveUrl?: string | null;
        publishedAt: string;
    }>
): string {
    if (!projectList.length) return "Belum ada data projek di database.";

    return projectList
        .map(
            (p, idx) =>
                `${idx + 1}. ${p.title} [${p.category.toUpperCase()} - Rilis: ${p.publishedAt}]
   - Ringkasan: ${p.summary}
   - Detail: ${p.description}
   - Tech Stack: ${p.tags.join(", ")}
   - GitHub: ${p.githubUrl || "-"} | Live Demo: ${p.liveUrl || "Belum dideploy"}`
        )
        .join("\n\n");
}

router.post("/", chatLimiter, async (req: Request, res: Response) => {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({
                success: false,
                message: "GEMINI_API_KEY belum terbaca di file .env server.",
            });
        }

        const parsed = ChatRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(422).json({
                success: false,
                message: parsed.error.issues[0]?.message || "Format pesan tidak valid.",
            });
        }

        const { message, history = [] } = parsed.data;
        const projectsContext = await getProjectsContext();
        const ai = new GoogleGenAI({ apiKey });

        const systemInstruction = `
Kamu adalah kembaran digital (AI Assistant) dari **Gerald**, seorang Software & Web Developer asal Indonesia.
Gunakan sudut pandang orang pertama ("saya" atau "aku") seolah-olah pengunjung sedang ngobrol langsung dengan Gerald versi santai.

GAYA BAHASA & KEPRIBADIAN:
- Santai, ramah, agak receh/lucu khas anak IT, tapi tetap informatif dan jelas saat menjelaskan teknis.
- Jawab singkat dan padat (maksimal 2-3 paragraf pendek atau poin-poin) supaya enak dibaca di jendela chat kecil.

PROFIL GERALD:
- Keahlian Utama: Fullstack Web Development (Next.js 16, React, TypeScript, Tailwind CSS, Node.js, Express, PHP 8, Laravel 13), Desktop App (C# .NET WPF), serta Database & Caching (MySQL, SQL Server, SQLite, Drizzle ORM, Redis).
- GitHub: github.com/alphaXV46 | Portfolio Live: geraldportfolio-ivory.vercel.app.
- Bisa dihubungi lebih lanjut lewat halaman Contact di website ini.

DATA PROJEK RESMI DARI DATABASE MYSQL:
${projectsContext}

ATURAN KETAT (WAJIB DIPATUHI):
1. Kamu HANYA boleh menjawab pertanyaan seputar Gerald, keahlian teknisnya, pengalaman ngodingnya, dan daftar projek yang ada di data database di atas.
2. JIKA pengunjung bertanya di luar konteks (misalnya: minta dibuatkan kodingan PR/tugas, resep masakan, ramalan cuaca, curhat percintaan, politik, matematika, atau topik umum lain yang tidak ada hubungannya dengan portofolio Gerald), TOLAK dengan gaya bercanda yang sopan lalu belokkan obrolan kembali ke projek atau keahlian Gerald.
3. Jangan pernah mengarang projek fiktif yang tidak tertulis di data database di atas.
`.trim();

        // Sisipkan instruksi di awal contents agar kompatibel dengan seri Gemini maupun Gemma
        const formattedContents = [
            {
                role: "user" as const,
                parts: [
                    {
                        text: `INSTRUKSI SISTEM (PATUHI SEPENUHNYA):\n${systemInstruction}\n\nJawab "Siap!" jika mengerti, lalu mulai percakapan dengan pengunjung.`,
                    },
                ],
            },
            {
                role: "model" as const,
                parts: [{ text: "Siap!" }],
            },
            ...history.map((item) => ({
                role: item.role,
                parts: [{ text: item.text }],
            })),
            {
                role: "user" as const,
                parts: [{ text: message }],
            },
        ];

        let replyText: string | undefined;
        let usedModel = "";

        for (const modelName of MODEL_FALLBACK_CHAIN) {
            try {
                const response = await ai.models.generateContent({
                    model: modelName,
                    contents: formattedContents,
                    config: {
                        temperature: 0.35,
                        maxOutputTokens: 2048,
                    },
                });

                if (response.text) {
                    replyText = response.text;
                    usedModel = modelName;
                    break;
                }
            } catch (err: unknown) {
                const apiErr = err as { status?: number; message?: string };
                console.warn(
                    `[FALLBACK]: Model ${modelName} gagal (status: ${apiErr.status ?? "unknown"}), beralih ke model berikutnya...`
                );
            }
        }

        if (!replyText) {
            return res.status(503).json({
                success: false,
                message:
                    "Semua otak AI lagi kelelahan hari ini (limit harian tercapai). Coba lagi besok ya!",
            });
        }

        console.log(`[AI_SUCCESS]: Dijawab oleh ${usedModel}`);

        return res.status(200).json({
            success: true,
            reply: replyText,
        });
    } catch (error: unknown) {
        const err = error as Error;
        console.error("[CHAT_GEMINI_ERROR]:", err);
        return res.status(500).json({
            success: false,
            message: "Server AI lagi ngopi sebentar, coba kirim pesan lagi nanti ya.",
        });
    }
});

export default router;