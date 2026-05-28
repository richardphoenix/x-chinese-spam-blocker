import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listPending } from "@/lib/db/submissions";
import { SubmissionRow } from "./submission-row";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Auth gate at the page level (Node runtime) — more reliable than edge middleware
  // with next-auth v5's lazy config. Server actions also re-check the session.
  const session = await auth();
  if (!session) redirect("/login");

  const pending = await listPending();
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
      <h1>待审核 spam 提交（{pending.length}）</h1>
      {pending.length === 0 ? <p>队列为空。</p> : null}
      {pending.map((sub) => (
        <SubmissionRow key={sub.id} sub={sub} />
      ))}
    </main>
  );
}
