"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getSubmission, markApproved, markRejected } from "@/lib/db/submissions";
import { commitApprovedEntry } from "@/lib/github";

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
