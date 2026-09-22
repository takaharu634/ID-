import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const dataImports = sqliteTable("data_imports", {
  id: text("id").primaryKey(),
  fileName: text("file_name").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  rawObjectKey: text("raw_object_key").notNull(),
  summaryObjectKey: text("summary_object_key").notNull(),
  pitchCount: integer("pitch_count").notNull(),
  gameCount: integer("game_count").notNull(),
  teamCount: integer("team_count").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
});
