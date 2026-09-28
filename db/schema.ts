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

export const trackmanPushState = sqliteTable("trackman_push_state", {
  id: text("id").primaryKey(),
  enabled: integer("enabled").notNull().default(0),
  scriptUrl: text("script_url"),
  lastEventAt: integer("last_event_at"),
  lastSuccessAt: integer("last_success_at"),
  lastError: text("last_error"),
  lastResult: text("last_result"),
});
export const trackmanPushChannels = sqliteTable("trackman_push_channels", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  resourceId: text("resource_id"),
  expiresAt: integer("expires_at").notNull(),
  lastMessage: text("last_message"),
});
export const trackmanPushFiles = sqliteTable("trackman_push_files", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  fingerprint: text("fingerprint"),
  completedAt: integer("completed_at").notNull(),
});
