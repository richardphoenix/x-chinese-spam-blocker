import { NextResponse } from "next/server";
import { validateSubmission } from "@/lib/validate";
import { getSubmitRatelimit, clientIp } from "@/lib/ratelimit";
import { upsertSubmission } from "@/lib/db/submissions";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_BATCH = 100;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  // One rate-limit token for the whole batch (vs one per account).
  const ip = clientIp(req.headers);
  const { success } = await getSubmitRatelimit().limit(ip);
  if (!success) {
    return NextResponse.json({ error: "提交过于频繁，请稍后再试" }, { status: 429, headers: CORS });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400, headers: CORS });
  }

  const accounts = (body as { accounts?: unknown })?.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return NextResponse.json({ error: "accounts 必须是非空数组" }, { status: 400, headers: CORS });
  }
  if (accounts.length > MAX_BATCH) {
    return NextResponse.json({ error: `单次最多 ${MAX_BATCH} 个账号` }, { status: 400, headers: CORS });
  }

  let created = 0;
  let duplicate = 0;
  let invalid = 0;
  for (const raw of accounts) {
    const result = validateSubmission(raw);
    if (!result.ok) {
      invalid++;
      continue;
    }
    const { created: isNew } = await upsertSubmission(result.value);
    if (isNew) created++;
    else duplicate++;
  }

  return NextResponse.json({ ok: true, created, duplicate, invalid }, { status: 200, headers: CORS });
}
