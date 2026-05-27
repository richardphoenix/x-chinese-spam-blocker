# 黑名单审核后台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Next.js + Neon 后台，让用户通过 userscript 一键提交疑似 spam 账号进入待审核队列，维护者用 GitHub 登录审核，通过的账号被 commit 进 `blocklist/blocklist.json`。

**Architecture:** Next.js 15 App Router 应用放在仓库 `web/` 子目录。公开 `POST /api/submit` 端点经限流+校验+按 `user_id` 去重后写入 Neon `submissions` 表。`/admin` 经 GitHub OAuth（allowlist 锁单管理员）保护，审核通过时用管理员的 OAuth token 读取并追加 `blocklist/blocklist.json` 后 commit 回 main。核心逻辑（校验、去重追加）抽成纯函数做 TDD，DB/网络包成薄封装。

**Tech Stack:** Next.js 15, TypeScript, bun, Drizzle ORM + Neon, Auth.js v5 (GitHub provider), @upstash/ratelimit, Octokit, vitest, shadcn/ui (baseui variant)。

**关联 spec:** `docs/superpowers/specs/2026-05-27-blocklist-review-backend-design.md`

---

## 文件结构

应用根目录 `web/`，相对它的路径如下：

- `app/api/submit/route.ts` — 公开提交端点（薄 wrapper）
- `app/admin/page.tsx` — 审核台页面（Server Component 读列表）
- `app/admin/submission-row.tsx` — 单条提交的客户端表单行（编辑 + 通过/拒绝）
- `app/admin/actions.ts` — `approveSubmission` / `rejectSubmission` server actions
- `auth.ts` — Auth.js 配置（GitHub provider + allowlist + token 透传）
- `middleware.ts` — 保护 `/admin`
- `lib/env.ts` — 环境变量校验与导出
- `lib/db/schema.ts` — Drizzle `submissions` 表定义
- `lib/db/client.ts` — Neon + Drizzle 客户端
- `lib/db/submissions.ts` — DB 操作薄封装（upsert/list/updateStatus）
- `lib/validate.ts` — `validateSubmission` 纯函数
- `lib/ratelimit.ts` — Upstash 限流器
- `lib/blocklist.ts` — `buildBlocklistEntry` / `upsertBlocklistEntry` 纯函数
- `lib/github.ts` — Octokit 读文件 + commit 薄封装
- `lib/__tests__/*.test.ts` — vitest 单测

仓库根目录改动：

- `userscript/x-chinese-spam-blocker.user.js` — 提交改走 API
- `docs/installation.md` / `blocklist/submissions/README.md` — 文档更新

---

### Task 1: 在 web/ 脚手架 Next.js + vitest

**Files:**
- Create: `web/`（Next.js 项目）
- Create: `web/vitest.config.ts`
- Create: `web/lib/__tests__/smoke.test.ts`

- [ ] **Step 1: 创建 Next.js 应用**

Run（在仓库根目录）:
```bash
bunx create-next-app@latest web --ts --app --tailwind --eslint --src-dir=false --import-alias "@/*" --no-turbopack --use-bun
```
对交互提示一律接受默认。

- [ ] **Step 2: 安装运行期与开发依赖**

Run:
```bash
cd web && bun add drizzle-orm @neondatabase/serverless next-auth@beta @upstash/ratelimit @upstash/redis octokit zod && bun add -d drizzle-kit vitest @types/node
```

- [ ] **Step 3: 配置 vitest**

Create `web/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["lib/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

在 `web/package.json` 的 `scripts` 中加入：
```json
"test": "vitest run",
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate"
```

- [ ] **Step 4: 写一个 smoke 测试确认 vitest 跑得通**

Create `web/lib/__tests__/smoke.test.ts`:
```ts
import { expect, test } from "vitest";

test("vitest runs", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd web && bun run test`
Expected: 1 passed。

- [ ] **Step 6: 提交**

```bash
git add web docs && git commit -m "chore: scaffold Next.js app in web/ with vitest"
```

---

### Task 2: 环境变量校验模块

**Files:**
- Create: `web/lib/env.ts`
- Create: `web/.env.example`
- Test: `web/lib/__tests__/env.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/lib/__tests__/env.test.ts`:
```ts
import { expect, test } from "vitest";
import { parseEnv } from "@/lib/env";

const full = {
  DATABASE_URL: "postgres://x",
  AUTH_SECRET: "s",
  AUTH_GITHUB_ID: "id",
  AUTH_GITHUB_SECRET: "secret",
  ADMIN_GITHUB_LOGIN: "richardphoenix",
  UPSTASH_REDIS_REST_URL: "https://u",
  UPSTASH_REDIS_REST_TOKEN: "t",
  GITHUB_REPO_OWNER: "richardphoenix",
  GITHUB_REPO_NAME: "x-chinese-spam-blocker",
  GITHUB_BLOCKLIST_PATH: "blocklist/blocklist.json",
  GITHUB_BRANCH: "main",
};

test("parses a full env", () => {
  const env = parseEnv(full);
  expect(env.ADMIN_GITHUB_LOGIN).toBe("richardphoenix");
});

test("throws when a required var is missing", () => {
  const { DATABASE_URL, ...rest } = full;
  expect(() => parseEnv(rest)).toThrow();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd web && bun run test lib/__tests__/env.test.ts`
Expected: FAIL（`parseEnv` 未定义）。

- [ ] **Step 3: 实现**

Create `web/lib/env.ts`:
```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  AUTH_GITHUB_ID: z.string().min(1),
  AUTH_GITHUB_SECRET: z.string().min(1),
  ADMIN_GITHUB_LOGIN: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.string().min(1),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  GITHUB_REPO_OWNER: z.string().min(1),
  GITHUB_REPO_NAME: z.string().min(1),
  GITHUB_BLOCKLIST_PATH: z.string().min(1),
  GITHUB_BRANCH: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  return schema.parse(source);
}

export const env: Env = parseEnv(process.env as Record<string, string | undefined>);
```

Create `web/.env.example`:
```
DATABASE_URL=
AUTH_SECRET=
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
ADMIN_GITHUB_LOGIN=richardphoenix
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
GITHUB_REPO_OWNER=richardphoenix
GITHUB_REPO_NAME=x-chinese-spam-blocker
GITHUB_BLOCKLIST_PATH=blocklist/blocklist.json
GITHUB_BRANCH=main
```

- [ ] **Step 4: 运行确认通过**

Run: `cd web && bun run test lib/__tests__/env.test.ts`
Expected: 2 passed。

- [ ] **Step 5: 提交**

```bash
git add web && git commit -m "feat: add validated env config"
```

---

### Task 3: 提交字段校验纯函数

**Files:**
- Create: `web/lib/validate.ts`
- Test: `web/lib/__tests__/validate.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/lib/__tests__/validate.test.ts`:
```ts
import { expect, test } from "vitest";
import { validateSubmission } from "@/lib/validate";

test("accepts a valid submission and normalizes optional fields", () => {
  const r = validateSubmission({
    user_id: "1234567890",
    screen_name: "spam_acct",
    display_name: "锦颖🌸 寻固炮 🌸",
    tweet_text: "🌸 寻固炮 🌸 点击主页",
    source_url: "https://x.com/spam_acct/status/1",
    detected_reasons: ["keyword:寻固炮"],
    detected_score: 73,
  });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.user_id).toBe("1234567890");
    expect(r.value.detected_reasons).toEqual(["keyword:寻固炮"]);
  }
});

test("rejects non-numeric user_id", () => {
  const r = validateSubmission({ user_id: "abc" });
  expect(r.ok).toBe(false);
});

test("rejects missing user_id", () => {
  const r = validateSubmission({});
  expect(r.ok).toBe(false);
});

test("defaults optional fields", () => {
  const r = validateSubmission({ user_id: "42" });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.detected_reasons).toEqual([]);
    expect(r.value.screen_name).toBe("");
    expect(r.value.detected_score).toBe(0);
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd web && bun run test lib/__tests__/validate.test.ts`
Expected: FAIL（`validateSubmission` 未定义）。

- [ ] **Step 3: 实现**

Create `web/lib/validate.ts`:
```ts
import { z } from "zod";

const schema = z.object({
  user_id: z.string().regex(/^\d{1,25}$/, "user_id must be numeric"),
  screen_name: z.string().max(50).optional().default(""),
  display_name: z.string().max(200).optional().default(""),
  tweet_text: z.string().max(2000).optional().default(""),
  source_url: z.string().max(500).optional().default(""),
  detected_reasons: z.array(z.string().max(200)).max(50).optional().default([]),
  detected_score: z.number().int().min(0).max(100).optional().default(0),
});

export type ValidSubmission = z.infer<typeof schema>;

export type ValidateResult =
  | { ok: true; value: ValidSubmission }
  | { ok: false; errors: string[] };

export function validateSubmission(input: unknown): ValidateResult {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, errors: parsed.error.issues.map((i) => i.message) };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd web && bun run test lib/__tests__/validate.test.ts`
Expected: 4 passed。

- [ ] **Step 5: 提交**

```bash
git add web && git commit -m "feat: add submission validation"
```

---

### Task 4: blocklist 条目拼装与去重追加纯函数

**Files:**
- Create: `web/lib/blocklist.ts`
- Test: `web/lib/__tests__/blocklist.test.ts`

这是审核「通过」的核心逻辑，决定写进 `blocklist.json` 的内容与去重行为。

- [ ] **Step 1: 写失败测试**

Create `web/lib/__tests__/blocklist.test.ts`:
```ts
import { expect, test } from "vitest";
import { buildBlocklistEntry, upsertBlocklistEntry } from "@/lib/blocklist";

const review = {
  user_id: "1234567890",
  screen_name: "spam_acct",
  display_name: "锦颖🌸 寻固炮 🌸",
  category: "寻固炮",
  reason: "典型寻固炮模板",
  evidence: "https://x.com/spam_acct/status/1",
};

test("buildBlocklistEntry maps review fields to blocklist schema", () => {
  const e = buildBlocklistEntry(review, "2026-05-27");
  expect(e).toEqual({
    user_id: "1234567890",
    screen_name: "spam_acct",
    name: "锦颖🌸 寻固炮 🌸",
    reason: "典型寻固炮模板",
    category: "寻固炮",
    added: "2026-05-27",
    evidence: "https://x.com/spam_acct/status/1",
  });
});

test("upsert appends a new entry", () => {
  const entry = buildBlocklistEntry(review, "2026-05-27");
  const result = upsertBlocklistEntry([], entry);
  expect(result.added).toBe(true);
  expect(result.list).toHaveLength(1);
});

test("upsert is a no-op when user_id already present", () => {
  const entry = buildBlocklistEntry(review, "2026-05-27");
  const existing = [{ ...entry, reason: "old" }];
  const result = upsertBlocklistEntry(existing, entry);
  expect(result.added).toBe(false);
  expect(result.list).toHaveLength(1);
  expect(result.list[0].reason).toBe("old");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd web && bun run test lib/__tests__/blocklist.test.ts`
Expected: FAIL（函数未定义）。

- [ ] **Step 3: 实现**

Create `web/lib/blocklist.ts`:
```ts
export type BlocklistEntry = {
  user_id: string;
  screen_name: string;
  name: string;
  reason: string;
  category: string;
  added: string;
  evidence: string;
};

export type ReviewInput = {
  user_id: string;
  screen_name: string;
  display_name: string;
  category: string;
  reason: string;
  evidence: string;
};

export function buildBlocklistEntry(r: ReviewInput, addedDate: string): BlocklistEntry {
  return {
    user_id: r.user_id,
    screen_name: r.screen_name,
    name: r.display_name,
    reason: r.reason,
    category: r.category,
    added: addedDate,
    evidence: r.evidence,
  };
}

export function upsertBlocklistEntry(
  list: BlocklistEntry[],
  entry: BlocklistEntry,
): { list: BlocklistEntry[]; added: boolean } {
  if (list.some((e) => String(e.user_id) === String(entry.user_id))) {
    return { list, added: false };
  }
  return { list: [...list, entry], added: true };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd web && bun run test lib/__tests__/blocklist.test.ts`
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add web && git commit -m "feat: add blocklist entry build/upsert logic"
```

---

### Task 5: Drizzle schema 与迁移

**Files:**
- Create: `web/lib/db/schema.ts`
- Create: `web/drizzle.config.ts`
- Create: `web/drizzle/`（生成的迁移）

- [ ] **Step 1: 定义 schema**

Create `web/lib/db/schema.ts`:
```ts
import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const submissions = pgTable("submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().unique(),
  screenName: text("screen_name").notNull().default(""),
  displayName: text("display_name").notNull().default(""),
  tweetText: text("tweet_text").notNull().default(""),
  sourceUrl: text("source_url").notNull().default(""),
  detectedReasons: jsonb("detected_reasons").$type<string[]>().notNull().default([]),
  detectedScore: integer("detected_score").notNull().default(0),
  votes: integer("votes").notNull().default(1),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  category: text("category"),
  reason: text("reason"),
  evidence: text("evidence"),
  reviewNotes: text("review_notes"),
  firstSubmittedAt: timestamp("first_submitted_at", { withTimezone: true }).notNull().defaultNow(),
  lastSubmittedAt: timestamp("last_submitted_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

export type Submission = typeof submissions.$inferSelect;
```

- [ ] **Step 2: 配置 drizzle-kit**

Create `web/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 3: 生成迁移**

Run: `cd web && bun run db:generate`
Expected: 在 `web/drizzle/` 下生成 `.sql` 迁移文件，无报错。

- [ ] **Step 4: 提交**

```bash
git add web && git commit -m "feat: add submissions schema and migration"
```

> 注：实际 `db:migrate` 需要真实 `DATABASE_URL`，在部署前置环节执行（见末尾「部署与联调」）。

---

### Task 6: DB 客户端与 submissions 仓储封装

**Files:**
- Create: `web/lib/db/client.ts`
- Create: `web/lib/db/submissions.ts`

- [ ] **Step 1: DB 客户端**

Create `web/lib/db/client.ts`:
```ts
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { env } from "@/lib/env";
import * as schema from "./schema";

const sql = neon(env.DATABASE_URL);
export const db = drizzle(sql, { schema });
```

- [ ] **Step 2: 仓储封装**

Create `web/lib/db/submissions.ts`:
```ts
import { desc, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { submissions, type Submission } from "./schema";
import type { ValidSubmission } from "@/lib/validate";

// Insert or, if user_id exists, bump votes + last_submitted_at. Returns whether a new row was created.
export async function upsertSubmission(v: ValidSubmission): Promise<{ created: boolean }> {
  const result = await db
    .insert(submissions)
    .values({
      userId: v.user_id,
      screenName: v.screen_name,
      displayName: v.display_name,
      tweetText: v.tweet_text,
      sourceUrl: v.source_url,
      detectedReasons: v.detected_reasons,
      detectedScore: v.detected_score,
    })
    .onConflictDoUpdate({
      target: submissions.userId,
      set: {
        votes: sql`${submissions.votes} + 1`,
        lastSubmittedAt: new Date(),
      },
    })
    .returning({ votes: submissions.votes });
  // votes === 1 means it was just inserted fresh.
  return { created: result[0]?.votes === 1 };
}

export async function listPending(): Promise<Submission[]> {
  return db
    .select()
    .from(submissions)
    .where(eq(submissions.status, "pending"))
    .orderBy(desc(submissions.votes), desc(submissions.lastSubmittedAt));
}

export async function getSubmission(id: string): Promise<Submission | undefined> {
  const rows = await db.select().from(submissions).where(eq(submissions.id, id)).limit(1);
  return rows[0];
}

export async function markApproved(
  id: string,
  fields: { category: string; reason: string; evidence: string },
): Promise<void> {
  await db
    .update(submissions)
    .set({ status: "approved", reviewedAt: new Date(), ...fields })
    .where(eq(submissions.id, id));
}

export async function markRejected(id: string, notes: string): Promise<void> {
  await db
    .update(submissions)
    .set({ status: "rejected", reviewedAt: new Date(), reviewNotes: notes })
    .where(eq(submissions.id, id));
}
```

- [ ] **Step 3: 类型检查**

Run: `cd web && bunx tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 4: 提交**

```bash
git add web && git commit -m "feat: add db client and submissions repository"
```

---

### Task 7: 限流器

**Files:**
- Create: `web/lib/ratelimit.ts`
- Test: `web/lib/__tests__/ratelimit.test.ts`

- [ ] **Step 1: 写测试（验证模块导出与降级）**

Create `web/lib/__tests__/ratelimit.test.ts`:
```ts
import { expect, test } from "vitest";
import { clientIp } from "@/lib/ratelimit";

test("clientIp prefers x-forwarded-for first hop", () => {
  const h = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
  expect(clientIp(h)).toBe("1.2.3.4");
});

test("clientIp falls back to a constant when header absent", () => {
  expect(clientIp(new Headers())).toBe("unknown");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd web && bun run test lib/__tests__/ratelimit.test.ts`
Expected: FAIL（`clientIp` 未定义）。

- [ ] **Step 3: 实现**

Create `web/lib/ratelimit.ts`:
```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";

export const submitRatelimit = new Ratelimit({
  redis: new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  }),
  limiter: Ratelimit.slidingWindow(10, "1 m"),
  prefix: "submit",
});

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd web && bun run test lib/__tests__/ratelimit.test.ts`
Expected: 2 passed。

- [ ] **Step 5: 提交**

```bash
git add web && git commit -m "feat: add submit rate limiter"
```

---

### Task 8: POST /api/submit 路由

**Files:**
- Create: `web/app/api/submit/route.ts`

- [ ] **Step 1: 实现路由**

Create `web/app/api/submit/route.ts`:
```ts
import { NextResponse } from "next/server";
import { validateSubmission } from "@/lib/validate";
import { submitRatelimit, clientIp } from "@/lib/ratelimit";
import { upsertSubmission } from "@/lib/db/submissions";

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
  const { success } = await submitRatelimit.limit(ip);
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
```

- [ ] **Step 2: 类型检查**

Run: `cd web && bunx tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 3: 提交**

```bash
git add web && git commit -m "feat: add POST /api/submit endpoint"
```

---

### Task 9: GitHub OAuth 鉴权 + 保护 /admin

**Files:**
- Create: `web/auth.ts`
- Create: `web/app/api/auth/[...nextauth]/route.ts`
- Create: `web/middleware.ts`
- Create: `web/app/login/page.tsx`

OAuth scope 用 `public_repo`（仓库公开，足够 commit）。

- [ ] **Step 1: Auth.js 配置**

Create `web/auth.ts`:
```ts
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { env } from "@/lib/env";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: env.AUTH_GITHUB_ID,
      clientSecret: env.AUTH_GITHUB_SECRET,
      authorization: { params: { scope: "read:user public_repo" } },
    }),
  ],
  callbacks: {
    // Only the allowlisted maintainer may sign in.
    async signIn({ profile }) {
      return profile?.login === env.ADMIN_GITHUB_LOGIN;
    },
    // Persist the GitHub access token + login so we can commit as the maintainer.
    async jwt({ token, account, profile }) {
      if (account?.access_token) token.accessToken = account.access_token;
      if (profile?.login) token.login = profile.login as string;
      return token;
    },
    async session({ session, token }) {
      (session as { accessToken?: string }).accessToken = token.accessToken as string | undefined;
      (session as { login?: string }).login = token.login as string | undefined;
      return session;
    },
  },
});
```

- [ ] **Step 2: 路由处理器**

Create `web/app/api/auth/[...nextauth]/route.ts`:
```ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

- [ ] **Step 3: 中间件保护 /admin**

Create `web/middleware.ts`:
```ts
import { auth } from "@/auth";

export default auth((req) => {
  if (!req.auth) {
    const url = new URL("/login", req.nextUrl.origin);
    return Response.redirect(url);
  }
});

export const config = { matcher: ["/admin/:path*"] };
```

- [ ] **Step 4: 登录页**

Create `web/app/login/page.tsx`:
```tsx
import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <main style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <form
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: "/admin" });
        }}
      >
        <button type="submit">用 GitHub 登录</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: 类型检查**

Run: `cd web && bunx tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 6: 提交**

```bash
git add web && git commit -m "feat: add GitHub OAuth with single-admin allowlist"
```

---

### Task 10: GitHub commit 服务

**Files:**
- Create: `web/lib/github.ts`

读 `blocklist/blocklist.json`、用 `upsertBlocklistEntry` 去重、commit 回 main。用传入的 OAuth token 作为 commit 身份。

- [ ] **Step 1: 实现**

Create `web/lib/github.ts`:
```ts
import { Octokit } from "octokit";
import { env } from "@/lib/env";
import {
  buildBlocklistEntry,
  upsertBlocklistEntry,
  type BlocklistEntry,
  type ReviewInput,
} from "@/lib/blocklist";

type FileState = { list: BlocklistEntry[]; sha: string };

async function readBlocklist(octokit: Octokit): Promise<FileState> {
  const res = await octokit.rest.repos.getContent({
    owner: env.GITHUB_REPO_OWNER,
    repo: env.GITHUB_REPO_NAME,
    path: env.GITHUB_BLOCKLIST_PATH,
    ref: env.GITHUB_BRANCH,
  });
  if (Array.isArray(res.data) || res.data.type !== "file") {
    throw new Error("blocklist path is not a file");
  }
  const content = Buffer.from(res.data.content, "base64").toString("utf-8");
  const list = JSON.parse(content) as BlocklistEntry[];
  return { list, sha: res.data.sha };
}

// Returns "added" if a new entry was committed, "exists" if user_id was already present.
export async function commitApprovedEntry(
  accessToken: string,
  review: ReviewInput,
): Promise<"added" | "exists"> {
  const octokit = new Octokit({ auth: accessToken });
  const { list, sha } = await readBlocklist(octokit);

  const addedDate = new Date().toISOString().slice(0, 10);
  const entry = buildBlocklistEntry(review, addedDate);
  const { list: nextList, added } = upsertBlocklistEntry(list, entry);
  if (!added) return "exists";

  const nextContent = JSON.stringify(nextList, null, 2) + "\n";
  await octokit.rest.repos.createOrUpdateFileContents({
    owner: env.GITHUB_REPO_OWNER,
    repo: env.GITHUB_REPO_NAME,
    path: env.GITHUB_BLOCKLIST_PATH,
    branch: env.GITHUB_BRANCH,
    message: `blocklist: add ${review.screen_name || review.user_id}`,
    content: Buffer.from(nextContent, "utf-8").toString("base64"),
    sha,
  });
  return "added";
}
```

- [ ] **Step 2: 类型检查**

Run: `cd web && bunx tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 3: 提交**

```bash
git add web && git commit -m "feat: add GitHub commit service for approved entries"
```

---

### Task 11: 审核 server actions（approve / reject）

**Files:**
- Create: `web/app/admin/actions.ts`

- [ ] **Step 1: 实现**

Create `web/app/admin/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getSubmission, markApproved, markRejected } from "@/lib/db/submissions";
import { commitApprovedEntry } from "@/lib/github";

export async function approveSubmission(formData: FormData) {
  const session = await auth();
  const accessToken = (session as { accessToken?: string } | null)?.accessToken;
  if (!session || !accessToken) throw new Error("未授权");

  const id = String(formData.get("id"));
  const category = String(formData.get("category") ?? "其他");
  const reason = String(formData.get("reason") ?? "");
  const evidence = String(formData.get("evidence") ?? "");

  const sub = await getSubmission(id);
  if (!sub) throw new Error("提交不存在");

  // Commit to GitHub FIRST; only update Neon if the commit succeeds, to avoid drift.
  await commitApprovedEntry(accessToken, {
    user_id: sub.userId,
    screen_name: sub.screenName,
    display_name: sub.displayName,
    category,
    reason,
    evidence,
  });

  await markApproved(id, { category, reason, evidence });
  revalidatePath("/admin");
}

export async function rejectSubmission(formData: FormData) {
  const session = await auth();
  if (!session) throw new Error("未授权");
  const id = String(formData.get("id"));
  const notes = String(formData.get("notes") ?? "");
  await markRejected(id, notes);
  revalidatePath("/admin");
}
```

- [ ] **Step 2: 类型检查**

Run: `cd web && bunx tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 3: 提交**

```bash
git add web && git commit -m "feat: add approve/reject server actions"
```

---

### Task 12: /admin 审核台 UI

**Files:**
- Create: `web/app/admin/page.tsx`
- Create: `web/app/admin/submission-row.tsx`

- [ ] **Step 1: 审核行组件**

Create `web/app/admin/submission-row.tsx`:
```tsx
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
```

- [ ] **Step 2: 审核台页面**

Create `web/app/admin/page.tsx`:
```tsx
import { listPending } from "@/lib/db/submissions";
import { SubmissionRow } from "./submission-row";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const pending = await listPending();
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
      <h1>待审核 spam 提交（{pending.length}）</h1>
      {pending.length === 0 ? <p>队列为空。</p> : null}
      {pending.map((sub) => (
        <SubmissionRow key={sub.id} sub={sub} />
      ))}
    </main>
  );
}
```

- [ ] **Step 3: 类型检查 + 构建**

Run: `cd web && bunx tsc --noEmit && bun run build`
Expected: 构建成功（无 DB 连接时构建仍应通过，因为页面是 force-dynamic）。

- [ ] **Step 4: 提交**

```bash
git add web && git commit -m "feat: add admin review UI"
```

> 注：UI 先用内联样式保证可跑。落地后可按用户偏好用 shadcn/ui（baseui variant）替换 `select`/`input`/`button`/卡片，见 Task 15。

---

### Task 13: userscript 改为 POST API 提交

**Files:**
- Modify: `userscript/x-chinese-spam-blocker.user.js`

- [ ] **Step 1: 加 API 常量与 @connect**

在 `CONFIG` 对象中（`PANEL_Z_INDEX` 附近）加入：
```js
    // Backend submission API. Update to the deployed domain after first deploy.
    SUBMIT_API: 'https://x-chinese-spam-blocker.vercel.app/api/submit',
```
在脚本头 UserScript 块中，`// @connect x.com` 下方加入：
```js
// @connect      vercel.app
```

- [ ] **Step 2: 替换提交函数**

把 `submitCurrentSpamToDatabase()` 整个函数体替换为 POST 到后端：
```js
  function submitCurrentSpamToDatabase() {
    const visibleSpam = document.querySelector('article[data-testid="tweet"][data-spam-hidden="true"]') ||
                        document.querySelector('div[data-testid="UserCell"][data-spam-hidden="true"]');

    if (!visibleSpam) {
      alert('未找到当前页面已识别的 spam，请先让脚本隐藏到 spam 后再提交。');
      return;
    }

    const info = extractUserInfo(visibleSpam);
    if (!info || !info.userId) {
      alert('无法获取该账号的 user_id，暂时无法提交。');
      return;
    }

    const payload = {
      user_id: String(info.userId),
      screen_name: info.screenName || '',
      display_name: info.displayName || '',
      tweet_text: info.tweetText || '',
      source_url: window.location.href,
      detected_reasons: ['userscript-report'],
      detected_score: calculateSpamScore(info),
    };

    updatePanelStatus('正在提交到审核队列...');
    GM_xmlhttpRequest({
      method: 'POST',
      url: CONFIG.SUBMIT_API,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload),
      onload: (res) => {
        try {
          const data = JSON.parse(res.responseText);
          updatePanelStatus(data.message || '已提交，等待审核');
        } catch {
          updatePanelStatus(res.status === 200 ? '已提交，等待审核' : '提交失败');
        }
        setTimeout(() => updatePanelStatus('就绪'), 4000);
      },
      onerror: () => {
        updatePanelStatus('提交失败，请稍后重试');
        setTimeout(() => updatePanelStatus('就绪'), 4000);
      },
    });
  }
```

- [ ] **Step 3: bump 版本**

把 `// @version  0.5.0` 改为 `// @version  0.6.0`。

- [ ] **Step 4: 提交**

```bash
git add userscript && git commit -m "feat(userscript): submit reports to backend API (v0.6.0)"
```

---

### Task 14: 文档更新

**Files:**
- Modify: `blocklist/submissions/README.md`
- Modify: `docs/installation.md`
- Modify: `README.md`

- [ ] **Step 1: 更新提交流程文档**

把 `blocklist/submissions/README.md`（及 `README.md`、`docs/installation.md` 中提到「提交走 GitHub Issue」的描述）改为：提交经 userscript 按钮 → POST 到后台 API → 进 Neon 待审核队列 → 维护者在 `/admin` 审核 → 通过后自动 commit 进 `blocklist.json`。

- [ ] **Step 2: 提交**

```bash
git add README.md docs blocklist && git commit -m "docs: describe backend submission/review flow"
```

---

### Task 15: shadcn/ui 美化（可选收尾）

**Files:**
- Modify: `web/app/admin/submission-row.tsx`
- Modify: `web/app/login/page.tsx`

- [ ] **Step 1: 初始化 shadcn（baseui variant）**

Run: `cd web && bunx shadcn@latest init`，按用户偏好选择 baseui variant。
Run: `cd web && bunx shadcn@latest add button input select card textarea`

- [ ] **Step 2: 用 shadcn 组件替换内联样式控件**

把 `submission-row.tsx` 与 `login/page.tsx` 中的原生 `button`/`input`/`select` 换成 `@/components/ui/*` 对应组件，卡片外层用 `Card`。保持 `form action` 与 `name` 字段不变。

- [ ] **Step 3: 构建确认**

Run: `cd web && bun run build`
Expected: 构建成功。

- [ ] **Step 4: 提交**

```bash
git add web && git commit -m "style: use shadcn/ui (baseui) for admin and login"
```

---

## 部署与联调（人工，需真实凭据）

按 spec「部署前置」准备：GitHub OAuth App（`read:user public_repo` scope，回调 `https://<domain>/api/auth/callback/github`）、Neon、Upstash、`ADMIN_GITHUB_LOGIN`。

1. 在 Vercel 创建项目，root directory 设为 `web/`，填入全部环境变量。
2. 用真实 `DATABASE_URL` 跑 `cd web && bun run db:migrate` 建表。
3. 首次部署后，把 userscript `CONFIG.SUBMIT_API` 改为实际域名（若用自定义域名，同步在 `@connect` 增加该域名）。
4. 端到端验证：装脚本 → 在 X 上提交一个 spam → `/admin` 看到该条 → 点「通过」→ 确认 `blocklist/blocklist.json` 多了 commit 且条目正确 → 等 userscript 刷新后该账号进入可拉黑名单。

---

## Self-Review 记录

- **Spec 覆盖**：提交端点(Task 8)、限流+校验+去重(Task 3/7/8/6)、GitHub OAuth allowlist(Task 9)、审核台(Task 12)、通过写回+去重(Task 4/10/11)、commit 失败不改 Neon(Task 11 顺序)、reject 留痕隐藏(Task 6 `markRejected` + Task 12 仅列 pending)、userscript 改 API(Task 13)、文档(Task 14)、栈与部署前置(Task 1/部署节)。均有对应任务。
- **去重一致性**：`user_id` 为 DB 唯一键(Task 5) + `onConflictDoUpdate`(Task 6) + json 层 `upsertBlocklistEntry`(Task 4) 双重保证，命名一致。
- **类型一致性**：`ReviewInput`/`BlocklistEntry`(Task 4) 被 Task 10/11 复用；`ValidSubmission`(Task 3) 被 Task 6 复用；`Submission`(Task 5) 被 Task 6/12 复用。签名一致。
- **无占位符**：所有代码步骤含完整代码；唯一的「待定」是部署后才知道的 Vercel 域名，已显式标注为部署步骤而非代码空缺。
