import { auth } from "@/auth";
import { listPending } from "@/lib/db/submissions";
import { countBlocklistEntries } from "@/lib/github";
import { ReviewList } from "./review-list";

export const dynamic = "force-dynamic";

function Stat({ label, value, tone }: { label: string; value: number; tone: "amber" | "emerald" }) {
  const ring = tone === "amber" ? "text-amber-300" : "text-emerald-300";
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-5 py-4">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-1 font-[family-name:var(--font-display)] text-3xl font-bold tabular-nums ${ring}`}>
        {value}
      </div>
    </div>
  );
}

export default async function AdminPage() {
  const session = await auth();
  const token = (session as { accessToken?: string } | null)?.accessToken;

  const pending = await listPending();
  let blockCount = 0;
  try {
    if (token) blockCount = await countBlocklistEntries(token);
  } catch {
    blockCount = 0;
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-white">
          审核队列
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          社区提交的疑似 spam，逐条或批量审核后写入黑名单。
        </p>
      </div>

      <div className="mb-7 grid grid-cols-2 gap-3">
        <Stat label="待审核" value={pending.length} tone="amber" />
        <Stat label="已收录黑名单" value={blockCount} tone="emerald" />
      </div>

      {pending.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 px-6 py-16 text-center text-zinc-500">
          队列为空 — 没有待审核的提交。
        </div>
      ) : (
        <ReviewList submissions={pending} />
      )}
    </>
  );
}
