import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  activeStatementId: text("active_statement_id"),
  createdAt: integer("created_at").notNull(),
});
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("idx_sessions_expires").on(table.expiresAt)]);
export const statements = sqliteTable("statements", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  pdfKey: text("pdf_key").notNull(),
  portfolioKey: text("portfolio_key").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [index("idx_statements_user_created").on(table.userId, table.createdAt)]);
export const authLimits = sqliteTable("auth_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("idx_auth_limits_expires").on(table.expiresAt)]);
