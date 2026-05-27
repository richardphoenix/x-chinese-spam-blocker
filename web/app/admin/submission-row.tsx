"use client";

import { useState } from "react";
import type { Submission } from "@/lib/db/schema";
import { approveSubmission, rejectSubmission } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const CATEGORIES = ["寻固炮", "色情引流", "诈骗", "其他"];

export function SubmissionRow({ sub }: { sub: Submission }) {
  const [busy, setBusy] = useState(false);

  return (
    <Card className="mb-3">
      <CardHeader>
        <CardTitle>
          @{sub.screenName || "?"} · {sub.displayName} · 票数 {sub.votes} · 分 {sub.detectedScore}
        </CardTitle>
        <CardDescription>
          user_id: {sub.userId}
          {sub.sourceUrl ? (
            <>
              {" · "}
              <a href={sub.sourceUrl} target="_blank" rel="noreferrer" className="underline">来源</a>
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {sub.tweetText ? (
          <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground italic">{sub.tweetText}</blockquote>
        ) : null}
        <p className="text-xs text-muted-foreground">命中：{(sub.detectedReasons ?? []).join(", ")}</p>

        {/* Approve form */}
        <form
          action={async (fd) => {
            setBusy(true);
            try {
              await approveSubmission(fd);
            } finally {
              setBusy(false);
            }
          }}
          className="flex flex-wrap gap-2 items-center"
        >
          <input type="hidden" name="id" value={sub.id} />
          <Select name="category" defaultValue="寻固炮">
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input name="reason" placeholder="原因" defaultValue="寻固炮 spam / 引流诈骗" className="w-48" />
          <Input name="evidence" placeholder="证据链接" defaultValue={sub.sourceUrl ?? ""} className="w-48" />
          <Button type="submit" disabled={busy}>通过并写入黑名单</Button>
        </form>

        {/* Reject form */}
        <form
          action={async (fd) => {
            setBusy(true);
            try {
              await rejectSubmission(fd);
            } finally {
              setBusy(false);
            }
          }}
          className="flex gap-2 items-center"
        >
          <input type="hidden" name="id" value={sub.id} />
          <Input name="notes" placeholder="拒绝原因（可选）" className="w-64" />
          <Button type="submit" variant="destructive" disabled={busy}>拒绝</Button>
        </form>
      </CardContent>
    </Card>
  );
}
