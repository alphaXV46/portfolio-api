import "dotenv/config";
import Redis from "ioredis";

export const redis = new Redis(
    process.env.REDIS_URL || "redis://127.0.0.1:6379",
    {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        retryStrategy: () => null, // Berhenti mencoba reconnect otomatis jika Redis mati
    }
);

redis.on("connect", () => {
    console.log("Terhubung ke Redis Cache");
});

redis.on("error", (err) => {
    console.warn("[Redis Warning]: Layanan Redis tidak aktif ->", err.message);
});