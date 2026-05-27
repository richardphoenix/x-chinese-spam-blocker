# 黑名单审核后台设计（Vercel + Neon）

- 日期：2026-05-27
- 状态：已批准设计，待写实现计划
- 关联项目：x-chinese-spam-blocker

## 目标

为 `x-chinese-spam-blocker` 增加一个管理后台，让任意装了 userscript 的用户能在 X 页面上一键提交疑似 spam 账号，进入待审核队列；维护者（Richard，单管理员）登录后台审核，通过的账号被写入 `blocklist.json`，供 userscript 订阅消费。

取代现有的「打开 GitHub Issue」提交方式。

## 关键决策（已确认）

1. **黑名单最终来源仍是 `blocklist.json`**：Neon 存提交与审核状态；审核通过时后台用 GitHub API 把条目 commit 进 `blocklist.json`。userscript 消费路径不变（仍从 GitHub raw 读，6 小时刷新一次），保留 git 历史与公开透明。
2. **管理后台用 GitHub OAuth 登录**，allowlist 锁死维护者的 GitHub username；commit 用 session 中维护者本人的 OAuth token，commit 作者即维护者本人。
3. **公开提交端点采用轻量防滥用**：IP 限流 + 字段校验 + 按 `user_id` 去重（重复提交累加票数，不新建行）。
4. **userscript 完全弃用 GitHub Issue 提交**，全部改为 POST 到后台 API。
5. **拒绝（reject）的账号留痕**：置 `status=rejected` 后从 pending 队列隐藏，避免反复出现。

## 技术栈

- Next.js 15（App Router）+ TypeScript，依赖用 `bun` 管理
- shadcn/ui（baseui variant）做后台 UI
- Neon Postgres + Drizzle ORM
- Auth.js（NextAuth v5）GitHub provider，allowlist 限单一管理员
- @upstash/ratelimit + Upstash Redis（Vercel Marketplace 安装）做 IP 限流
- Octokit 提交 GitHub commit（OAuth App 需 `repo` scope）
- 仓库布局：在当前 repo 新增 `web/` 子目录放 Next.js 应用；Vercel 项目 root directory 设为 `web/`

## 架构与数据流

```
[userscript 用户] --POST /api/submit--> [Vercel/Next.js] --> [Neon: submissions(status=pending)]
                                                              ↑
[管理员] --GitHub OAuth 登录--> [/admin 审核台] --approve--> 更新 status + 用管理员 GitHub 身份
                                                              commit 进 blocklist.json
[userscript 所有用户] <--GitHub raw-- blocklist.json (路径不变, 6 小时刷新)
```

## 数据模型（Neon · `submissions` 表）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | |
| `user_id` | text unique | X 数字 id，去重键 |
| `screen_name` | text | |
| `display_name` | text | |
| `tweet_text` | text | |
| `source_url` | text | |
| `detected_reasons` | jsonb | 脚本传来的命中原因 |
| `detected_score` | int | 脚本检测分 |
| `votes` | int default 1 | 同 user_id 重复提交则累加 |
| `status` | text default `'pending'` | `pending` \| `approved` \| `rejected` |
| `first_submitted_at` | timestamptz | |
| `last_submitted_at` | timestamptz | |
| `category` | text | 审核时填，取值见下 |
| `reason` | text | 审核时填 |
| `evidence` | text | 审核时填 |
| `reviewed_at` | timestamptz | |
| `review_notes` | text | |

`category` 取值约定（沿用 `blocklist/README.md`）：`寻固炮` / `色情引流` / `诈骗` / `其他`。

去重逻辑：`/api/submit` 对 `user_id` 做 UPSERT——已存在则 `votes++`、更新 `last_submitted_at`，不新建行；审核队列里一个账号永远只占一条。

## 接口与页面

### `POST /api/submit`（公开）

1. IP 限流（如 10 次/分钟，Upstash）；命中返回 429 + 友好提示。
2. 字段校验：`user_id` 必填且为纯数字；文本字段长度上限；校验失败返回 400。
3. 按 `user_id` UPSERT；返回结果标明「新建」或「已存在（票数已 +1）」。

请求体字段（来自 userscript 提取）：`user_id`、`screen_name`、`display_name`、`tweet_text`、`source_url`、`detected_reasons`、`detected_score`。

### `/admin`（GitHub OAuth 登录后）

- 展示 pending 列表，默认按 `votes` 降序、其次 `last_submitted_at`。
- 每行展示：账号信息、证据/来源链接、脚本检测分、票数。
- 管理员可编辑 `category` / `reason` / `evidence`，然后点「通过」或「拒绝」。
- 已 reject 的账号从 pending 列表隐藏（可选保留一个「已拒绝」筛选视图查看留痕）。

### 通过（approve）动作

1. 读取 GitHub 上现有 `blocklist.json`。
2. 检查该 `user_id` 是否已存在于 json——已存在则只更新 Neon 状态，不重复追加。
3. 不存在则按现有 schema 追加条目：`user_id` / `screen_name` / `name`（取 `display_name`）/ `reason` / `category` / `added`（当天日期）/ `evidence`。
4. 用管理员 OAuth token commit 回 `main`。
5. commit 成功后 Neon 置 `status=approved`、填 `reviewed_at`。

## 错误处理与边界

- 提交端点：限流命中 429；校验失败 400。
- 通过时 GitHub commit 失败（冲突 / 网络）：**不**改 Neon 状态，提示重试，避免 Neon 与 `blocklist.json` 不一致。
- 重复通过同一 `user_id`：commit 前检查 json 是否已含该账号，存在则只更新 Neon 状态、不重复追加。
- userscript 端：提交失败显示错误 toast，成功显示成功 toast，不跳转离开页面。

## userscript 改动

- `submitCurrentSpamToDatabase()` 从「打开 GitHub Issue」改为 POST 到 `/api/submit`，提交后弹 toast。
- 脚本头需加 `// @connect <vercel 域名>` 以允许跨域请求。
- 其余隐藏 / 拉黑 / 黑名单加载逻辑不变。
- bump `// @version`。

## 测试

- `POST /api/submit`：校验、限流、去重 UPSERT（含重复提交累加票数）。
- 审核动作：通过时正确读取/追加/commit `blocklist.json`；重复通过不重复追加；commit 失败时不改 Neon 状态。
- 鉴权：非 allowlist 用户无法访问 `/admin` 与审核动作。

## 非目标（YAGNI）

- 多管理员 / 角色权限。
- 提交事件审计表（仅 `submissions` 单表）。
- Neon → `blocklist.json` 的定期导出/对账（采用即时 commit）。
- Turnstile / 验证码（先上轻量防滥用，观察后再决定）。

## 部署前置

- GitHub OAuth App（含 `repo` scope）的 client id / secret。
- Neon 数据库连接串。
- Upstash Redis（限流）连接信息。
- 管理员 GitHub username allowlist。
- Vercel 项目 root directory 设为 `web/`。
