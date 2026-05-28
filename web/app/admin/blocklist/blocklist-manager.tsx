"use client";

import { useMemo, useState, useTransition } from "react";
import type { BlocklistEntry } from "@/lib/blocklist";
import { removeFromBlocklistAction } from "../actions";

const PAGE_SIZE = 50;

export function BlocklistManager({ entries }: { entries: BlocklistEntry[] }) {
  const [list, setList] = useState(entries);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (e) =>
        String(e.screen_name || "").toLowerCase().includes(q) ||
        String(e.name || "").toLowerCase().includes(q),
    );
  }, [list, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function remove(screenName: string) {
    if (!screenName) return;
    setRemoving(screenName);
    startTransition(async () => {
      try {
        await removeFromBlocklistAction(screenName);
        setList((prev) =>
          prev.filter((e) => String(e.screen_name || "").toLowerCase() !== screenName.toLowerCase()),
        );
      } finally {
        setRemoving(null);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          placeholder="搜索 @句柄 或 名字…"
          className="min-w-[12rem] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none transition focus:border-amber-400/50"
        />
        <span className="text-xs text-zinc-500">
          共 {list.length} 个{query ? ` · 匹配 ${filtered.length}` : ""}
        </span>
      </div>

      <div className="divide-y divide-white/8 rounded-xl border border-white/8">
        {pageItems.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-500">没有匹配的账号。</div>
        ) : (
          pageItems.map((e) => (
            <div key={e.screen_name} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="truncate text-sm text-zinc-200">{e.name || "(无名)"}</span>
                  {e.screen_name ? (
                    <a
                      href={`https://x.com/${e.screen_name}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-mono text-xs text-sky-400 hover:underline"
                    >
                      @{e.screen_name}
                    </a>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                  {e.category ? (
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-amber-300/80">{e.category}</span>
                  ) : null}
                  {e.added ? <span>{e.added}</span> : null}
                  {e.evidence ? (
                    <a href={e.evidence} target="_blank" rel="noreferrer" className="text-sky-500 hover:underline">
                      证据 ↗
                    </a>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(e.screen_name)}
                disabled={pending && removing === e.screen_name}
                className="shrink-0 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50"
              >
                {pending && removing === e.screen_name ? "移除中…" : "移除"}
              </button>
            </div>
          ))
        )}
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="rounded-lg border border-white/10 px-3 py-1 text-zinc-300 transition hover:border-white/25 disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-zinc-500">
            第 {safePage + 1} / {pageCount} 页
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            className="rounded-lg border border-white/10 px-3 py-1 text-zinc-300 transition hover:border-white/25 disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      ) : null}
    </div>
  );
}
