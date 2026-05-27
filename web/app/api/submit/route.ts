import { NextResponse } from "next/server";
import { validateSubmission } from "@/lib/validate";
import { getSubmitRatelimit, clientIp } from "@/lib/ratelimit";
import { upsertSubmission } from "@/lib/db/submissions";

// Prevent Next.js from statically evaluating this route at build time,
// which would trigger env validation before credentials are available.
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const { success } = await getSubmitRatelimit().limit(ip);
  if (!success) {
    return NextResponse.json(
      { error: "提交过于频繁，请稍后再试" },
      { status: 429, headers: CORS },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400, headers: CORS });
  }

  const result = validateSubmission(body);
  if (!result.ok) {
    return NextResponse.json({ error: "校验失败", details: result.errors }, { status: 400, headers: CORS });
  }

  const { created } = await upsertSubmission(result.value);
  return NextResponse.json(
    { ok: true, created, message: created ? "已提交，等待审核" : "该账号已在队列中，已记录你的反馈" },
    { status: 200, headers: CORS },
  );
}
