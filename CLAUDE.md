# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

针对中文 X（Twitter）上「寻固炮 / 免费曰p / 想找会疼人的哥哥」等批量诈骗、引流 spam 的社区防御工具。三块互相独立又联通的产物：

1. **Tampermonkey 油猴脚本**（`userscript/`）— 用户端,实时折叠隐藏 + 批量提交 + 从黑名单批量拉黑。
2. **社区数据**（`blocklist/`）— `blocklist.json`(维护者审核过的黑名单) + `spam-keywords.txt`(启发式关键词)。
3. **审核后台**（`web/`）— Next.js + Neon + Vercel,接收提交、维护者审核、把通过的条目 commit 进 `blocklist.json`、在线编辑关键词。线上:`https://x-chinese-spam-blocker.vercel.app`。

userscript 没构建系统(纯文本 JS);`web/` 有完整 Next.js 16 工程,用 `bun` + vitest。

## 端到端数据流(理解任何一处改动前先抓住这条线)

```
[userscript] 隐藏 (关键词+维护者黑名单) ──[页面 user_id 从头像 URL 解析]──>
   POST /api/submit/batch ──> [Neon submissions, status=pending, 按 user_id UPSERT 累加 votes]
[维护者] 登录 /admin (GitHub OAuth, allowlist=ADMIN_GITHUB_LOGIN, 页面层 auth()守卫)
   通过 ──> 用维护者 OAuth token 把条目 commit 进 blocklist.json (主分支)
[userscript] 每 6 小时刷新 GitHub raw blocklist.json + spam-keywords.txt
```

raw URL 在脚本 `CONFIG` 中硬编码指向 `richardphoenix/x-chinese-spam-blocker` 的 `main`,所以 `blocklist/` 下的改动必须 push 到 `main` 才对线上用户生效。raw 有约 5 分钟 CDN 缓存,不是秒更。

## 仓库结构

```
userscript/x-chinese-spam-blocker.user.js   # 单文件 IIFE,用户产物
blocklist/
  blocklist.json                            # 正式黑名单(user_id + 证据)
  spam-keywords.txt                         # 关键词,# 开头是注释
  submissions/                              # 流程说明(实际队列在 Neon)
web/                                        # 审核后台 Next.js 应用,Vercel 部署
  app/api/submit/route.ts                   # 单条提交
  app/api/submit/batch/route.ts             # 批量提交(userscript 用这个)
  app/admin/                                # 后台 UI
  app/admin/keywords/                       # 关键词在线编辑
  auth.ts                                   # next-auth v5 配置 (GitHub OAuth + allowlist)
  lib/env.ts                                # zod 校验的 env,懒 Proxy
  lib/db/*                                  # Drizzle schema + 仓储
  lib/github.ts                             # Octokit 读写 blocklist.json / spam-keywords.txt
  lib/blocklist.ts                          # 纯函数: 拼装 entry + 去重 upsert
  lib/validate.ts                           # zod 提交校验
  lib/ratelimit.ts                          # Upstash 限流 + clientIp
docs/superpowers/                           # 设计 spec 与实现 plan(本项目用 superpowers 流程开发)
```

## 用户脚本核心架构

整个脚本是 `userscript/x-chinese-spam-blocker.user.js` 的单个 IIFE。三条独立路径:

1. **实时隐藏**(默认开,启发式) — `MutationObserver` + 周期扫描时间线,`calculateSpamScore()` 打分:关键词命中(+35+8/条)、显示名含关键词(+30)、极短文本+多 emoji(+22)、低质纯 emoji(+15)、乱码句柄机器人(+40,见下「已知 spam 模式」)。`score >= 40` → `hideElement` **折叠**该元素(隐藏所有子元素 + 插入一条细栏「已隐藏 @xxx · 显示 · 误杀→加白名单」)。
2. **批量提交**(`提交全部隐藏账号`) — 遍历 `hiddenItems`,在点击时刻**重新从存下的元素解析 user_id**(头像懒加载,隐藏时刻可能为空),组装一个数组 POST 到 `/api/submit/batch`,服务端去重。
3. **批量拉黑**(`从维护者黑名单拉黑`) — 仅对 `blocklist.json` 里维护者审核过的 `user_id` 生效,**绝不**用启发式分数。走 X 内部 `POST /i/api/1.1/blocks/create.json`(`X_BEARER` 常量 + cookie 里的 `ct0`),10 秒/个、单 session 上限、429 自动暂停 30 分钟。

**`shouldHide` 优先级**:本地白名单(`GM_setValue` 持久化,**按 @screen_name 小写**,永不隐藏) > 本地手动隐藏 `localBlocklist`(按 screen_name) > 维护者黑名单精确匹配 > 启发式分数(规则 1–6)。

**面板底部四个计数都可点开成模态**:正式黑名单(只读)/ 本次隐藏(看推文内容、逐条恢复并加白)/ 本地白名单(可移除)/ 本地隐藏(手动隐藏的账号,可移除)。每条推文悬停还有「🚫 隐藏」手动按钮。

## 已知 spam 模式与对抗(随对抗演进,新增判据前先读这里)

- **寻固炮系 / 免费曰p系 / 想找会疼人的哥哥系** — 中文话术写在显示名或推文里,靠 `spam-keywords.txt` 关键词命中。注意形似字 `曰p`↔`日p`。
- **「全国安排」头像机器人系**(2026-05 观察) — 招嫖话术「全国安排」只画在**头像图片**里(脚本读不到图片文字),显示名是随机字母乱码(如 `Hqzbrc`/`Qnegk`/`Bihysuq`),句柄 = 显示名小写 + 随机数字(`@hqzbrc85482`),推文是无害随机英文(音乐/心碎)+ emoji。**关键词完全失效**。靠 `calculateSpamScore()` **规则 6** 的结构启发式:显示名 `^[A-Za-z]{5,12}$` 且 句柄小写 == 显示名小写 + `\d{3,}` 且 名字是乱码(`元音比 ≤ 0.2` 或(`最长辅音串 ≥ 3` 且 `元音比 < 0.3`))。已验证抓全样本、放过 Brandon/Andrew/Steven/Kevin 等真名。这是 **auto-hide**。
- **「同城上门」emoji 垃圾系**(2026-05 观察) — 头像图片里是「同城上门」,但**显示名是正常西方人名**(`Sabina Famiano`),句柄也像真名,推文是**散落 emoji + 孤立单字母 + 数字、没有真词**(`🙂x ❤️ 23😀 🌖 🕺H`)。名字/关键词全失效。**曾用规则 7 自动抓(无真词 + 孤立单字母 + emoji≥3),但会误伤爱发 emoji 的真实用户,已移除**。改为**人工判断**:每条推文悬停出现「🚫 隐藏」按钮(`addManualHideButton`),用户点了 → 加入持久化 `localBlocklist`(按 screen_name)+ 折叠;`shouldHide` 检查 `localBlocklist`,所以以后自动折叠。面板第 4 个计数「本地隐藏」可查看/移除。
  - 注意坑:**X 的 emoji 是 `<img>`,`textContent` 取不到**,数 emoji 要用 `tweetTextEl.querySelectorAll('img').length`(`extractUserInfo` 的 `emojiCount`)。规则 2/5 用 textContent 数 emoji 其实基本失效,别依赖。
- **历史教训**:曾用过「任意字母+5位数字句柄」当 spam 信号(+28),**误杀严重**(`yy8796593412899` 这类正常自动句柄全中),已删除。新规则必须用「句柄==乱码名」这种高精度组合,不能只看「有数字」。
- **判据三分法**:能精准识别的(关键词、乱码句柄)→ auto-hide;模糊的(emoji 垃圾、头像藏话术、真人名)→ **不要 auto-hide**,交给每条推文的「🚫 隐藏」手动按钮(人是裁判,且记住)。加任何 auto-hide 判据前**务必 node 验证不误杀常见真名/真实用户**;宁可漏网走人工,也别误杀。
- 这些都是**结构启发式**,spammer 改名/改句柄/改文案即可绕过,对抗会持续。漏网就让用户手动隐藏 + 「提交全部隐藏账号」入审核队列。真正治本需读头像(OCR/图像识别),是另一个量级,暂未做。

## userscript 重要约束与坑(踩过的)

- **X 不在时间线 DOM 上暴露 `user_id`**(没 `data-user-id`),而 1.1 `users/show.json` 已被 X 关闭。**从头像 URL 解析**:`pbs.twimg.com/profile_images/<user_id>/...` 第一段路径就是 user_id。`extractUserInfo()` 用这个。免费、不调任何 API。
- **本地白名单按 screen_name(小写)存取**,因为 user_id 在 DOM 不可靠。
- DOM 选择器依赖 X 当前的 `data-testid`(`tweet` / `UserCell` / `tweetText` / `User-Name`)— 这是最脆的部分,X 改版会失效。
- 隐藏标记 `data-spam-hidden="true"` 打在 `cellInnerDiv`(推文)或 `UserCell`(用户卡片)上,**不在** `article` 上;选择器用 `[data-spam-hidden="true"]` 而不是 `article[data-spam-hidden]`。
- 改脚本必 bump `// @version`(Tampermonkey 据此自动更新)+ 同步面板标题里的版本字符串。`FALLBACK_KEYWORDS` 在远程拉取失败时用,可与 `spam-keywords.txt` 不完全同步但保留几条最关键的。
- 新增外部域名要加 `// @connect`。
- `spam-keywords.txt` 注意**形似字混淆**:`曰p` 与 `日p`、`曰P` 与 `日P` 都要分别收录,脚本未做字符归一化。

## 后台(`web/`)关键决策与坑

技术栈:Next.js 16 + React 19 + bun + Drizzle(neon-http)+ Upstash + next-auth v5 beta + Tailwind v4 + shadcn (base-nova)。

**踩过的坑**(都已修复,但改的时候要意识到):
- **env 必须懒加载**:`lib/env.ts` 用 `Proxy` 在首次属性访问时才 `parseEnv(process.env)`,否则 `next build` 在收集页面数据时就因 env 缺失抛 ZodError 失败。`lib/db/client.ts`、`lib/ratelimit.ts`、`auth.ts` 都用了类似的"延迟到请求时"模式。
- **Auth.js 用 lazy 工厂**:`NextAuth(() => ({...}))` 而不是 `NextAuth({...})`,同上原因。
- **/admin 用页面层 `auth()` 守卫,不用 middleware**:Next 16 对 middleware 默认导出做静态检查,next-auth v5 的 `export default auth(...)` 在 edge 会 `TypeError: xx is not a function`。我们改成 `app/admin/layout.tsx` 调 `await auth()` 后 `redirect("/login")`,server actions 也独立 re-check session(双重防护)。**不要**回退到 middleware.ts。
- **Upstash env 用集成提供的名字** `KV_REST_API_URL` / `KV_REST_API_TOKEN`(Vercel Marketplace 注入的)。我们的代码就读这两个;不要重命名为 `UPSTASH_REDIS_REST_URL`。
- **`vercel env pull` 会把 sensitive 变量(集成注入的、env add 加的 secret)拉成空字符串**。本地跑 `drizzle-kit migrate` 时要从 Neon 控制台拿连接串内联传入:`DATABASE_URL='...' bunx drizzle-kit migrate`,不能依赖 pull。
- 提交端点(`/api/submit` + `/api/submit/batch`)是公开的,带 IP 限流(`getSubmitRatelimit()`,20/分钟)+ CORS `*` + zod 校验 + 按 `user_id` UPSERT 去重。`createMany` 用 `onConflictDoUpdate` 累加票数。
- 通过审核时**先 commit GitHub 再改 Neon**(`commitApprovedEntries` → `markApproved`):若 commit 失败 Neon 留 `pending`,避免漂移。同一 user_id 重复通过不重复追加(json 层 `upsertBlocklistEntry` + DB 唯一键)。批量通过用**单次读 + 单次 commit**(`commitApprovedEntries` 接收数组)。

## 部署 / Vercel 设置

- **Vercel 项目**:`x-chinese-spam-blocker` under `richardphoenixs-projects`,**Root Directory = `web`**(必须,否则 git auto-build 找不到 package.json)。
- **生产域名**:`x-chinese-spam-blocker.vercel.app`。**GitHub OAuth App 的 callback URL** = `https://x-chinese-spam-blocker.vercel.app/api/auth/callback/github`(scope:`read:user public_repo`)。
- **git auto-deploy** 已开:push 到 `main` 触发自动构建部署。CLI `vercel deploy --cwd web` 会因 Root Directory 设置导致路径变 `web/web`,**改用 git push 触发部署**(以前手动 CLI 部署只是 Root Directory 设之前的临时手段)。
- **Ignored Build Step**:Settings → Git → 设为 `git diff --quiet HEAD^ HEAD ./` — 只在 `web/` 有变化时构建,审核通过产生的 blocklist.json commit 不会触发(它在 web/ 外)。
- **环境变量**:见 `web/.env.example`。集成自动注入的不用手动加。

## 编辑约束

- userscript 与 `blocklist/` 改动:push 到 `main` 才对线上用户生效,raw CDN ~5 分钟。
- `web/` 改动:push 后 git 自动部署,~30s 上线。
- 编辑 `blocklist.json` 后用 `python3 -m json.tool blocklist/blocklist.json` 校验。
- `web/` 改动跑 `cd web && bun run test && bunx tsc --noEmit` 自检。

## 测试

- `web/lib/__tests__/*` 有 vitest 单测覆盖纯函数(env / validate / blocklist / ratelimit/clientIp / smoke)。`cd web && bun run test`。
- DB/网络相关只做编译验证(`bun run build`),没集成测试。
- userscript 无自动化测试,靠手动安装后在 x.com 观察。
