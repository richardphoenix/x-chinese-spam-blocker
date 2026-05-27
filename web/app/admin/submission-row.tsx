"use client";

import { useState } from "react";
import type { Submission } from "@/lib/db/schema";
import { approveSubmission, rejectSubmission } from "./actions";

const CATEGORIES = ["寻固炮", "色情引流", "诈骗", "其他"];

export function SubmissionRow({ sub }: { sub: Submission }) {
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ border: "1px solid #38444d", borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <div style={{ fontWeight: 700 }}>
        @{sub.screenName || "?"} · {sub.displayName} · 票数 {sub.votes} · 分 {sub.detectedScore}
      </div>
      <div style={{ fontSize: 13, color: "#8899a6", margin: "4px 0" }}>
        user_id: {sub.userId}
        {sub.sourceUrl ? (
          <>
            {" · "}
            <a href={sub.sourceUrl} target="_blank" rel="noreferrer">来源</a>
          </>
        ) : null}
      </div>
      {sub.tweetText ? <blockquote style={{ margin: "4px 0" }}>{sub.tweetText}</blockquote> : null}
      <div style={{ fontSize: 12, color: "#8899a6" }}>命中：{(sub.detectedReasons ?? []).join(", ")}</div>

      <form
        action={async (fd) => {
          setBusy(true);
          try {
            await approveSubmission(fd);
          } finally {
            setBusy(false);
          }
        }}
        style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        <input type="hidden" name="id" value={sub.id} />
        <select name="category" defaultValue="寻固炮">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input name="reason" placeholder="原因" defaultValue="寻固炮 spam / 引流诈骗" />
        <input name="evidence" placeholder="证据链接" defaultValue={sub.sourceUrl ?? ""} />
        <button type="submit" disabled={busy}>通过并写入黑名单</button>
      </form>

      <form
        action={async (fd) => {
          setBusy(true);
          try {
            await rejectSubmission(fd);
          } finally {
            setBusy(false);
          }
        }}
        style={{ marginTop: 6, display: "flex", gap: 8 }}
      >
        <input type="hidden" name="id" value={sub.id} />
        <input name="notes" placeholder="拒绝原因（可选）" />
        <button type="submit" disabled={busy}>拒绝</button>
      </form>
    </div>
  );
}
