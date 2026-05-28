import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./client";
import { submissions, type Submission } from "./schema";
import type { ValidSubmission } from "@/lib/validate";

// Insert or, if screen_name exists, bump votes + last_submitted_at. Returns whether a new row was created.
export async function upsertSubmission(v: ValidSubmission): Promise<{ created: boolean }> {
  const result = await db
    .insert(submissions)
    .values({
      screenName: v.screen_name,
      userId: v.user_id || null,
      displayName: v.display_name,
      tweetText: v.tweet_text,
      sourceUrl: v.source_url,
      detectedReasons: v.detected_reasons,
      detectedScore: v.detected_score,
    })
    .onConflictDoUpdate({
      target: submissions.screenName,
      set: {
        votes: sql`${submissions.votes} + 1`,
        lastSubmittedAt: new Date(),
      },
    })
    .returning({ votes: submissions.votes });
  // votes === 1 means it was just inserted fresh.
  return { created: result[0]?.votes === 1 };
}

export async function listPending(): Promise<Submission[]> {
  return db
    .select()
    .from(submissions)
    .where(eq(submissions.status, "pending"))
    .orderBy(desc(submissions.votes), desc(submissions.lastSubmittedAt));
}

export async function getSubmission(id: string): Promise<Submission | undefined> {
  const rows = await db.select().from(submissions).where(eq(submissions.id, id)).limit(1);
  return rows[0];
}

export async function markApproved(
  id: string,
  fields: { category: string; reason: string; evidence: string },
): Promise<void> {
  await db
    .update(submissions)
    .set({ status: "approved", reviewedAt: new Date(), ...fields })
    .where(eq(submissions.id, id));
}

export async function markRejected(id: string, notes: string): Promise<void> {
  await db
    .update(submissions)
    .set({ status: "rejected", reviewedAt: new Date(), reviewNotes: notes })
    .where(eq(submissions.id, id));
}

export async function getSubmissionsByIds(ids: string[]): Promise<Submission[]> {
  if (ids.length === 0) return [];
  return db.select().from(submissions).where(inArray(submissions.id, ids));
}

export async function markRejectedMany(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(submissions)
    .set({ status: "rejected", reviewedAt: new Date() })
    .where(inArray(submissions.id, ids));
}
