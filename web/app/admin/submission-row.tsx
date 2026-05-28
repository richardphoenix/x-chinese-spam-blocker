"use client";

import { useState } from "react";
import type { Submission } from "@/lib/db/schema";
import { approveSubmission, rejectSubmission } from "./actions";

const CATEGORIES = ["寻固炮", "色情引流", "诈骗", "其他"];
const DEFAULT_REASON = "寻固炮 spam / 引流诈骗";

export function SubmissionRow({ sub }: { sub: Submission }) {
  const [busy, setBusy] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);

  function withBusy(action: (fd: FormData) => Promise<void>) {
    return async (fd: FormData) => {
      setBusy(true);
      try {
        await action(fd);
      } finally {
        setBusy(false);
      }
    };
  }

  return (
    <article className="rounded-xl border border-white/8 bg-white/[0.03] p-4 transition hover:border-white/15 hover:bg-white/[0.05]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="truncate font-medium text-zinc-100">{sub.displayName || "(无名)"}</span>
            <span className="truncate font-mono text-xs text-zinc-500">@{sub.screenName || "?"}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-full bg-amber-400/10 px-2 py-0.5 font-medium text-amber-300">
              票数 {sub.votes}
            </span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-zinc-400">分 {sub.detectedScore}</span>
            <span className="font-mono text-zinc-600">{sub.userId}</span>
          </div>
        </div>
        {sub.sourceUrl ? (
          <a
            href={sub.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs text-sky-400 transition hover:text-sky-300 hover:underline"
          >
            来源 ↗
          </a>
        ) : null}
      </div>

      {sub.tweetText ? (
        <p className="mt-2.5 whitespace-pre-wrap break-words rounded-lg bg-black/25 px-3 py-2 text-sm text-zinc-400">
          {sub.tweetText}
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <form action={withBusy(approveSubmission)}>
          <input type="hidden" name="id" value={sub.id} />
          <input type="hidden" name="category" value="寻固炮" />
          <input type="hidden" name="reason" value={DEFAULT_REASON} />
          <input type="hidden" name="evidence" value={sub.sourceUrl ?? ""} />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-emerald-500/90 px-3.5 py-1.5 text-sm font-medium text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            通过
          </button>
        </form>

        <form action={withBusy(rejectSubmission)}>
          <input type="hidden" name="id" value={sub.id} />
          <input type="hidden" name="notes" value="" />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg border border-rose-500/40 px-3.5 py-1.5 text-sm font-medium text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50"
          >
            拒绝
          </button>
        </form>

        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v)}
          className="ml-auto text-xs text-zinc-500 transition hover:text-zinc-300"
        >
          {customOpen ? "收起" : "改分类…"}
        </button>
      </div>

      {customOpen ? (
        <form
          action={withBusy(approveSubmission)}
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/8 pt-3"
        >
          <input type="hidden" name="id" value={sub.id} />
          <select
            name="category"
            defaultValue="寻固炮"
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-amber-400/50"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            name="reason"
            defaultValue={DEFAULT_REASON}
            placeholder="原因"
            className="min-w-[6rem] flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-amber-400/50"
          />
          <input
            name="evidence"
            defaultValue={sub.sourceUrl ?? ""}
            placeholder="证据链接"
            className="min-w-[6rem] flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-amber-400/50"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-amber-400 px-3.5 py-1.5 text-sm font-medium text-amber-950 transition hover:bg-amber-300 disabled:opacity-50"
          >
            按分类通过
          </button>
        </form>
      ) : null}
    </article>
  );
}
