import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { redis } from "./config/redis";
import projectRoutes from "./routes/project.routes";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
    cors({
        origin: [
            "http://localhost:3000",
            process.env.FRONTEND_URL || "https://geraldportfolio-ivory.vercel.app",
        ],
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true,
    })
);

app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
        success: true,
        service: "portfolio-api",
        redisStatus: redis.status,
        timestamp: new Date().toISOString(),
    });
});

// Endpoint CRUD Projects
app.use("/api/projects", projectRoutes);

app.listen(PORT, async () => {
    try {
        await redis.connect();
    } catch {
        console.warn("Server berjalan tanpa Redis cache aktif.");
    }
    console.log(`Server Express berjalan di http://localhost:${PORT}`);
});