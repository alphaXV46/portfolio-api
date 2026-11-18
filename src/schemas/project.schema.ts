import { z } from "zod";

export const CreateProjectSchema = z.object({
    title: z.string().min(1, "Judul wajib diisi"),
    slug: z
        .string()
        .min(1, "Slug wajib diisi")
        .regex(/^[a-z0-9-]+$/, "Slug hanya boleh huruf kecil, angka, dan tanda hubung"),
    summary: z.string().min(10, "Ringkasan minimal 10 karakter"),
    description: z.string().min(10, "Deskripsi minimal 10 karakter"),
    category: z.enum(["fullstack", "web", "desktop"]),
    tags: z.array(z.string()).nonempty("Minimal satu tag teknologi diperlukan"),
    featured: z.boolean().default(false),
    githubUrl: z.string().url("Format URL GitHub tidak valid").optional().nullable(),
    liveUrl: z.string().url("Format URL Live tidak valid").optional().nullable(),
    stats: z.string().optional().nullable(),
    publishedAt: z.string().min(1, "Tanggal publikasi wajib diisi"),
});

// Untuk endpoint PUT, semua field bersifat opsional
export const UpdateProjectSchema = CreateProjectSchema.partial();