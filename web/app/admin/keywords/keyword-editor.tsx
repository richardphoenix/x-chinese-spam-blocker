"use client";

import { useState, useTransition } from "react";
import { saveKeywordsAction } from "../actions";

export function KeywordEditor({ initial }: { initial: string }) {
  const [content, setContent] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = content !== baseline;
  const keywordCount = content
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#")).length;

  function save() {
    startTransition(async () => {
      setStatus(null);
      try {
        await saveKeywordsAction(content);
        setBaseline(content);
        setStatus({ text: "已保存并提交到 GitHub", ok: true });
      } catch {
        setStatus({ text: "保存失败，请重试", ok: false });
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs">
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-zinc-400">{keywordCount} 个关键词</span>
        {dirty ? (
          <span className="text-amber-300">● 未保存</span>
        ) : (
          <span className="text-zinc-600">已是最新</span>
        )}
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
        className="h-[55vh] w-full resize-y rounded-xl border border-white/10 bg-black/30 p-4 font-mono text-sm leading-relaxed text-zinc-200 outline-none transition focus:border-amber-400/50"
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950 transition hover:bg-amber-300 disabled:opacity-40"
        >
          {pending ? "保存中…" : "保存并提交"}
        </button>
        {dirty ? (
          <button
            type="button"
            onClick={() => setContent(baseline)}
            disabled={pending}
            className="text-xs text-zinc-500 transition hover:text-zinc-300"
          >
            放弃修改
          </button>
        ) : null}
        {status ? (
          <span className={`text-sm ${status.ok ? "text-emerald-400" : "text-rose-400"}`}>
            {status.text}
          </span>
        ) : null}
      </div>

      <p className="text-xs leading-relaxed text-zinc-600">
        提示：userscript 每 6 小时刷新关键词，改完几分钟内对所有用户生效。注意「曰p」与「日p」等形似字变体需各自单独收录。
      </p>
    </div>
  );
}
