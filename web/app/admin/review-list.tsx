"use client";

import { useState, useTransition } from "react";
import type { Submission } from "@/lib/db/schema";
import { SubmissionRow } from "./submission-row";
import { approveBatch, rejectBatch } from "./actions";

export function ReviewList({ submissions }: { submissions: Submission[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const allSelected = submissions.length > 0 && selected.size === submissions.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(submissions.map((s) => s.id)));
  }

  function runBatch(action: (ids: string[]) => Promise<void>) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      await action(ids);
      setSelected(new Set());
    });
  }

  const count = selected.size;

  return (
    <div className="space-y-2.5">
      <div className="sticky top-[58px] z-10 flex items-center gap-2 rounded-xl border border-white/8 bg-[#0a0c10]/90 px-3 py-2 backdrop-blur-md">
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            className="size-4 accent-amber-400"
            checked={allSelected}
            onChange={toggleAll}
          />
          全选
        </label>
        {pending ? <span className="text-xs text-zinc-500">处理中…</span> : null}
        <button
          type="button"
          disabled={count === 0 || pending}
          onClick={() => runBatch(approveBatch)}
          className="ml-auto rounded-lg bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-40"
        >
          通过选中{count ? ` ${count}` : ""}
        </button>
        <button
          type="button"
          disabled={count === 0 || pending}
          onClick={() => runBatch(rejectBatch)}
          className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm font-medium text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-40"
        >
          拒绝选中{count ? ` ${count}` : ""}
        </button>
      </div>

      {submissions.map((sub, i) => (
        <div
          key={sub.id}
          className="reveal flex items-start gap-2.5"
          style={{ animationDelay: `${Math.min(i * 35, 350)}ms` }}
        >
          <input
            type="checkbox"
            className="mt-4 size-4 shrink-0 accent-amber-400"
            checked={selected.has(sub.id)}
            onChange={() => toggle(sub.id)}
          />
          <div className="min-w-0 flex-1">
            <SubmissionRow sub={sub} />
          </div>
        </div>
      ))}
    </div>
  );
}
