import { Router, Request, Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../config/db";
import { redis } from "../config/redis";
import { projects } from "../db/schema";
import {
    CreateProjectSchema,
    UpdateProjectSchema,
} from "../schemas/project.schema";

const router = Router();
const CACHE_KEY_ALL = "projects:all";

// 1. READ ALL — GET /api/projects (Cek Redis Cache dulu, fallback ke MySQL)
router.get("/", async (_req: Request, res: Response) => {
    try {
        if (redis.status === "ready") {
            const cached = await redis.get(CACHE_KEY_ALL);
            if (cached) {
                return res.status(200).json({
                    success: true,
                    source: "redis-cache",
                    data: JSON.parse(cached),
                });
            }
        }

        const rows = await db
            .select()
            .from(projects)
            .orderBy(desc(projects.publishedAt));

        // Normalisasi id ke string agar sinkron dengan Zod schema di Next.js
        const formatted = rows.map((row) => ({
            ...row,
            id: String(row.id),
        }));

        if (redis.status === "ready") {
            await redis.set(CACHE_KEY_ALL, JSON.stringify(formatted), "EX", 3600);
        }

        return res.status(200).json({
            success: true,
            source: "mysql-db",
            data: formatted,
        });
    } catch (error) {
        console.error("[GET_PROJECTS_ERROR]:", error);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil daftar projek",
        });
    }
});

// 2. READ ONE BY SLUG — GET /api/projects/:slug
router.get("/:slug", async (req: Request, res: Response) => {
    try {
        const slug = String(req.params.slug);
        const result = await db
            .select()
            .from(projects)
            .where(eq(projects.slug, slug));

        if (result.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Projek tidak ditemukan",
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                ...result[0],
                id: String(result[0].id),
            },
        });
    } catch (error) {
        console.error("[GET_PROJECT_DETAIL_ERROR]:", error);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil detail projek",
        });
    }
});

// 3. CREATE — POST /api/projects
router.post("/", async (req: Request, res: Response) => {
    try {
        const parsed = CreateProjectSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(422).json({
                success: false,
                errors: parsed.error.flatten().fieldErrors,
            });
        }

        await db.insert(projects).values(parsed.data);

        // Hapus cache lama agar request GET berikutnya mengambil data terbaru
        if (redis.status === "ready") {
            await redis.del(CACHE_KEY_ALL);
        }

        return res.status(201).json({
            success: true,
            message: "Projek baru berhasil ditambahkan",
            data: parsed.data,
        });
    } catch (error: unknown) {
        const err = error as { code?: string };
        if (err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                success: false,
                message: "Slug sudah digunakan oleh projek lain",
            });
        }
        console.error("[CREATE_PROJECT_ERROR]:", error);
        return res.status(500).json({
            success: false,
            message: "Gagal menyimpan projek baru",
        });
    }
});

// 4. UPDATE — PUT /api/projects/:id
router.put("/:id", async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ success: false, message: "ID tidak valid" });
        }

        const parsed = UpdateProjectSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(422).json({
                success: false,
                errors: parsed.error.flatten().fieldErrors,
            });
        }

        const existing = await db.select().from(projects).where(eq(projects.id, id));
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: "Projek tidak ditemukan" });
        }

        await db.update(projects).set(parsed.data).where(eq(projects.id, id));

        if (redis.status === "ready") {
            await redis.del(CACHE_KEY_ALL);
        }

        return res.status(200).json({
            success: true,
            message: "Projek berhasil diperbarui",
        });
    } catch (error) {
        console.error("[UPDATE_PROJECT_ERROR]:", error);
        return res.status(500).json({
            success: false,
            message: "Gagal memperbarui projek",
        });
    }
});

// 5. DELETE — DELETE /api/projects/:id
router.delete("/:id", async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ success: false, message: "ID tidak valid" });
        }

        const existing = await db.select().from(projects).where(eq(projects.id, id));
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: "Projek tidak ditemukan" });
        }

        await db.delete(projects).where(eq(projects.id, id));

        if (redis.status === "ready") {
            await redis.del(CACHE_KEY_ALL);
        }

        return res.status(200).json({
            success: true,
            message: "Projek berhasil dihapus",
        });
    } catch (error) {
        console.error("[DELETE_PROJECT_ERROR]:", error);
        return res.status(500).json({
            success: false,
            message: "Gagal menghapus projek",
        });
    }
});

export default router;