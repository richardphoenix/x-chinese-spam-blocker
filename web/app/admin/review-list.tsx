"use client";

import { useState, useTransition } from "react";
import type { Submission } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
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

  return (
    <div>
      <div
        style={{
          position: "sticky",
          top: 0,
          background: "#15202b",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 0",
          marginBottom: 8,
          borderBottom: "1px solid #38444d",
          zIndex: 1,
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          全选
        </label>
        <Button disabled={selected.size === 0 || pending} onClick={() => runBatch(approveBatch)}>
          通过选中 ({selected.size})
        </Button>
        <Button
          variant="secondary"
          disabled={selected.size === 0 || pending}
          onClick={() => runBatch(rejectBatch)}
        >
          拒绝选中 ({selected.size})
        </Button>
        {pending ? <span style={{ fontSize: 13, color: "#8899a6" }}>处理中…</span> : null}
      </div>

      {submissions.map((sub) => (
        <div key={sub.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={selected.has(sub.id)}
            onChange={() => toggle(sub.id)}
            style={{ marginTop: 18 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <SubmissionRow sub={sub} />
          </div>
        </div>
      ))}
    </div>
  );
}
