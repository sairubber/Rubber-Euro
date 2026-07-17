import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const analysesTable = pgTable("analyses", {
  id: serial("id").primaryKey(),
  market: text("market").notNull(),
  run_mode: text("run_mode").notNull().default("normal"), // 'normal' or 'delta'
  payload_json: text("payload_json").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAnalysisSchema = createInsertSchema(analysesTable).omit({ id: true, created_at: true });
export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type Analysis = typeof analysesTable.$inferSelect;

export const flashAlertsTable = pgTable("flash_alerts", {
  id: serial("id").primaryKey(),
  headline_input: text("headline_input").notNull(),
  payload_json: text("payload_json").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFlashAlertSchema = createInsertSchema(flashAlertsTable).omit({ id: true, created_at: true });
export type InsertFlashAlert = z.infer<typeof insertFlashAlertSchema>;
export type FlashAlert = typeof flashAlertsTable.$inferSelect;

export const weeklyReportsTable = pgTable("weekly_reports", {
  id: serial("id").primaryKey(),
  market: text("market").notNull(),
  week_start: text("week_start").notNull(), // YYYY-MM-DD string
  payload_json: text("payload_json").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWeeklyReportSchema = createInsertSchema(weeklyReportsTable).omit({ id: true, created_at: true });
export type InsertWeeklyReport = z.infer<typeof insertWeeklyReportSchema>;
export type WeeklyReport = typeof weeklyReportsTable.$inferSelect;

export const scorecardsTable = pgTable("scorecards", {
  id: serial("id").primaryKey(),
  market: text("market").notNull(),
  payload_json: text("payload_json").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScorecardSchema = createInsertSchema(scorecardsTable).omit({ id: true, created_at: true });
export type InsertScorecard = z.infer<typeof insertScorecardSchema>;
export type Scorecard = typeof scorecardsTable.$inferSelect;

export const outcomesTable = pgTable("outcomes", {
  id: serial("id").primaryKey(),
  market: text("market").notNull(),
  analysis_id: integer("analysis_id").notNull().references(() => analysesTable.id),
  outcome_text: text("outcome_text").notNull(),
  entered_at: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOutcomeSchema = createInsertSchema(outcomesTable).omit({ id: true, entered_at: true });
export type InsertOutcome = z.infer<typeof insertOutcomeSchema>;
export type Outcome = typeof outcomesTable.$inferSelect;

export const failedRunsTable = pgTable("failed_runs", {
  id: serial("id").primaryKey(),
  prompt_type: text("prompt_type").notNull(),
  raw_response: text("raw_response").notNull(),
  error: text("error").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFailedRunSchema = createInsertSchema(failedRunsTable).omit({ id: true, created_at: true });
export type InsertFailedRun = z.infer<typeof insertFailedRunSchema>;
export type FailedRun = typeof failedRunsTable.$inferSelect;
