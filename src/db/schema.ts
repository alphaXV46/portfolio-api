import {
    mysqlTable,
    serial,
    varchar,
    text,
    json,
    boolean,
    timestamp,
} from "drizzle-orm/mysql-core";

export const projects = mysqlTable("projects", {
    id: serial("id").primaryKey(),
    title: varchar("title", { length: 150 }).notNull(),
    slug: varchar("slug", { length: 150 }).notNull().unique(),
    summary: text("summary").notNull(),
    description: text("description").notNull(),
    category: varchar("category", { length: 50 }).notNull(), // 'fullstack' | 'web' | 'desktop'
    tags: json("tags").$type<string[]>().notNull(),
    featured: boolean("featured").default(false).notNull(),
    githubUrl: varchar("github_url", { length: 255 }),
    liveUrl: varchar("live_url", { length: 255 }),
    stats: varchar("stats", { length: 100 }),
    publishedAt: varchar("published_at", { length: 20 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
});

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;