import { listPending } from "@/lib/db/submissions";
import { SubmissionRow } from "./submission-row";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
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
