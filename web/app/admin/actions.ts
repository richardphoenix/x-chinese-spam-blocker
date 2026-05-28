"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  getSubmission,
  getSubmissionsByIds,
  markApproved,
  markRejected,
  markRejectedMany,
} from "@/lib/db/submissions";
import { commitApprovedEntry, commitApprovedEntries } from "@/lib/github";

const DEFAULT_CATEGORY = "寻固炮";
const DEFAULT_REASON = "寻固炮 spam / 引流诈骗";

export async function approveSubmission(formData: FormData) {
  const session = await auth();
  const accessToken = (session as { accessToken?: string } | null)?.accessToken;
  if (!session || !accessToken) throw new Error("未授权");

  const id = String(formData.get("id"));
  const category = String(formData.get("category") ?? "其他");
  const reason = String(formData.get("reason") ?? "");
  const evidence = String(formData.get("evidence") ?? "");

  const sub = await getSubmission(id);
  if (!sub) throw new Error("提交不存在");

  // Commit to GitHub FIRST; only update Neon if the commit succeeds, to avoid drift.
  await commitApprovedEntry(accessToken, {
    user_id: sub.userId,
    screen_name: sub.screenName,
    display_name: sub.displayName,
    category,
    reason,
    evidence,
  });

  await markApproved(id, { category, reason, evidence });
  revalidatePath("/admin");
}

export async function rejectSubmission(formData: FormData) {
  const session = await auth();
  if (!session) throw new Error("未授权");
  const id = String(formData.get("id"));
  const notes = String(formData.get("notes") ?? "");
  await markRejected(id, notes);
  revalidatePath("/admin");
}

// Bulk approve: one GitHub read + one commit for all selected, then mark each
// approved in Neon. Uses default category/reason (most spam is 寻固炮); use the
// per-row approve for anything needing a custom category.
export async function approveBatch(ids: string[]) {
  const session = await auth();
  const accessToken = (session as { accessToken?: string } | null)?.accessToken;
  if (!session || !accessToken) throw new Error("未授权");
  if (ids.length === 0) return;

  const subs = await getSubmissionsByIds(ids);
  if (subs.length === 0) return;

  // GitHub first (single commit); only touch Neon if it succeeds, to avoid drift.
  await commitApprovedEntries(
    accessToken,
    subs.map((s) => ({
      user_id: s.userId,
      screen_name: s.screenName,
      display_name: s.displayName,
      category: DEFAULT_CATEGORY,
      reason: DEFAULT_REASON,
      evidence: s.sourceUrl ?? "",
    })),
  );

  for (const s of subs) {
    await markApproved(s.id, {
      category: DEFAULT_CATEGORY,
      reason: DEFAULT_REASON,
      evidence: s.sourceUrl ?? "",
    });
  }
  revalidatePath("/admin");
}

export async function rejectBatch(ids: string[]) {
  const session = await auth();
  if (!session) throw new Error("未授权");
  await markRejectedMany(ids);
  revalidatePath("/admin");
}
