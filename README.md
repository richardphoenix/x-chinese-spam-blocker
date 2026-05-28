# X 中文 Spam 防御工具

针对中文 X（原 Twitter）上「寻固炮 / 免费曰p / 想找会疼人的哥哥」等大规模低俗、诈骗、引流 spam 的社区防御方案：一个 Tampermonkey 油猴脚本（实时隐藏 + 一键提交 + 批量拉黑）+ GitHub 托管的社区黑名单 + 维护者审核后台。

**GitHub**: https://github.com/richardphoenix/x-chinese-spam-blocker

---

## 🚀 一键安装

1. 先安装浏览器扩展 **[Tampermonkey](https://www.tampermonkey.net/)**
2. 点击安装脚本 👉 **[安装 X 中文 Spam 拦截器](https://raw.githubusercontent.com/richardphoenix/x-chinese-spam-blocker/main/userscript/x-chinese-spam-blocker.user.js)**
   Tampermonkey 会自动弹出安装窗口，点「安装」即可。
3. 打开 [x.com](https://x.com) 刷新页面，右下角出现控制面板即生效。

> ⚠️ **Chrome / Edge（MV3）** 需在 `chrome://extensions` 打开右上角 **开发者模式（Developer mode）**，并在 Tampermonkey 的 Details 里允许 **User Scripts / 所有网站访问**，否则脚本不会运行。
> 完整步骤、自动更新设置见 **[安装与使用指南](./docs/installation.md)**。

---

## 现状问题

大量机器人账号用动漫/美女头像 + 固定模板（🌸 寻固炮 🌸、免费曰p、想找会疼人的哥哥…）刷屏，目的是引流到微信/Telegram 进行诈骗或卖服务，严重破坏中文讨论环境。X 自带的过滤对这类中文 spam 几乎无效。

## 核心功能

- **实时隐藏**：匹配黑名单或关键词的推文/账号被折叠成一条细栏「已隐藏 @xxx · 显示 · 误杀→加白名单」，可展开复查、可一键救回。
- **一键提交**：面板「提交全部隐藏账号」把本次隐藏的账号一次性提交到审核队列（自动从头像解析 user_id，服务端去重）。
- **三个可点开的列表**：正式黑名单（只读）/ 本次隐藏（看推文内容、逐条恢复并加白）/ 本地白名单（可移除）。
- **从维护者黑名单批量拉黑**：只对维护者审核确认过的账号开放，10 秒/个、带队列、暂停、取消。
- **误杀防护**：本地白名单（按 @句柄）优先级最高；隐藏只折叠不删除，可随时恢复。
- **远程订阅 + 自动更新**：黑名单与关键词从 GitHub 自动加载、每 6 小时刷新；脚本本身支持 Tampermonkey 自动更新。

## 工作原理

```
[用户脚本] 实时隐藏（关键词 + 维护者黑名单）
     │ 一键提交疑似账号
     ▼
[审核后台 Vercel + Neon]  待审核队列（按票数排序，自动去重）
     │ 维护者登录审核（通过/拒绝，支持批量）
     ▼
[blocklist.json @ GitHub]  通过的账号写入正式黑名单
     ▲ 每 6 小时订阅刷新
[用户脚本] 隐藏 + 可批量拉黑
```

## 黑名单治理模式

- 正式黑名单（`blocklist/blocklist.json`）只包含**维护者人工审核确认**的账号，所有变更有 git 历史、公开透明。
- 社区用户通过脚本「提交」按钮把疑似账号送入**待审核队列**（Neon 数据库），同一账号重复提交累加票数、不重复建行；不直接进入正式黑名单。
- **批量拉黑只针对正式黑名单**生效，最大程度降低误杀风险。
- 关键词库（`blocklist/spam-keywords.txt`）用于启发式隐藏，由维护者在后台维护。

## 维护者后台

线上：**https://x-chinese-spam-blocker.vercel.app/admin** （GitHub 登录，仅限维护者账号）

- **审核队列**：逐条或批量「通过 / 拒绝」；通过即自动 commit 进 `blocklist.json`，拒绝留痕隐藏。
- **关键词**：在线编辑 `spam-keywords.txt`，保存即提交到 GitHub。

技术栈：Next.js + Neon Postgres + Upstash（限流）+ GitHub OAuth，部署在 Vercel。详见 [`web/`](./web)。

## 项目结构

```
x/
├── userscript/                        # 油猴脚本（用户主要使用）
│   └── x-chinese-spam-blocker.user.js
├── blocklist/                         # 社区数据（核心）
│   ├── blocklist.json                 # 正式黑名单（维护者审核，user_id + 证据）
│   ├── spam-keywords.txt              # 启发式检测关键词
│   └── submissions/                   # 提交流程说明（实际队列在 Neon）
├── web/                               # 审核后台（Next.js + Neon，部署到 Vercel）
├── discovery/                         # 账号发现策略文档
└── docs/                              # 安装/使用 + 设计与实现文档
```

## 如何贡献新 spam 账号

1. 用脚本的「提交全部隐藏账号」按钮提交（推荐，自动带 user_id 与上下文）。
2. 或直接在本仓库提 PR / Issue（附证据截图 + 链接）。

社区提交进入待审核队列，由维护者确认后才进入正式黑名单。

## 开发计划

- [x] 项目骨架
- [x] 初始黑名单 + 关键词库
- [x] 核心 userscript（折叠隐藏 + 批量提交 + 批量拉黑 + 列表查看）
- [x] 审核后台（提交 API + 审核队列 + 关键词编辑，已部署上线）
- [ ] 发现辅助工具
- [ ] 黑名单分发优化（量大后拆精简 id 列表）

## 免责与风险提示

- 批量拉黑存在账号被临时限制的风险，脚本已设保守的 10 秒间隔，请小批量操作。
- 请严格区分 spam 和正常用户，误杀会损害社区；隐藏可恢复、可加白名单。

欢迎一起把中文 X 环境变好一点。
