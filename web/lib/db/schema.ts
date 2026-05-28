import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const submissions = pgTable("submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Identity / dedup key. (user_id is vestigial — the avatar image id, not a real account id.)
  screenName: text("screen_name").notNull().unique(),
  userId: text("user_id"),
  displayName: text("display_name").notNull().default(""),
  tweetText: text("tweet_text").notNull().default(""),
  sourceUrl: text("source_url").notNull().default(""),
  detectedReasons: jsonb("detected_reasons").$type<string[]>().notNull().default([]),
  detectedScore: integer("detected_score").notNull().default(0),
  votes: integer("votes").notNull().default(1),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  category: text("category"),
  reason: text("reason"),
  evidence: text("evidence"),
  reviewNotes: text("review_notes"),
  firstSubmittedAt: timestamp("first_submitted_at", { withTimezone: true }).notNull().defaultNow(),
  lastSubmittedAt: timestamp("last_submitted_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

export type Submission = typeof submissions.$inferSelect;
