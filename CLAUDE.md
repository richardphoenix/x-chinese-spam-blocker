# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

针对中文 X（Twitter）上「寻固炮」等批量诈骗/引流 spam 账号的社区防御工具。核心是一个 Tampermonkey 油猴脚本 + GitHub 托管的黑名单/关键词数据。没有构建系统、依赖管理或测试套件——所有产物都是手写的纯文本（JS / JSON / TXT）。

## 仓库结构与数据流

```
userscript/x-chinese-spam-blocker.user.js   # 唯一的可执行代码（单文件 IIFE）
blocklist/blocklist.json                     # 维护者审核过的正式黑名单（user_id + 证据）
blocklist/spam-keywords.txt                  # 启发式检测关键词（每行一个，# 开头为注释）
blocklist/submissions/pending.json           # 社区待审核提交的占位模板
discovery/                                    # 账号发现策略文档（暂无代码）
docs/installation.md                          # 终端用户安装/使用指南
```

**关键运行时数据流**：脚本通过 `GM_xmlhttpRequest` 从 GitHub raw 拉取 `blocklist.json` 和 `spam-keywords.txt`。两个 URL 在脚本 `CONFIG` 中**硬编码指向 `richardphoenix/x-chinese-spam-blocker` 的 `main` 分支**。这意味着：编辑 `blocklist/` 下的数据文件后，必须推送到 GitHub `main` 才会对已安装脚本的用户生效——本地编辑不影响线上行为。脚本每 6 小时刷新一次远程黑名单。

## 核心架构（两层防御，安全级别不同）

整个脚本是 `userscript/x-chinese-spam-blocker.user.js` 中的单个 IIFE，理解它需抓住这两条独立路径：

1. **隐藏（默认开启，激进）** — `MutationObserver` + 周期扫描时间线，对每条推文/用户卡片调用 `calculateSpamScore()` 启发式打分（关键词命中、可疑句柄正则如 `Frank8408766657`、短文本+多 emoji 等）。`score >= 40` 即隐藏（仅降低不透明度，不真正删除）。这层会用启发式，可能误杀，所以只隐藏不拉黑。

2. **批量拉黑（需用户显式触发，保守）** — **只**对 `blocklist.json` 里维护者审核过的 `user_id` 生效，**绝不**使用启发式分数。通过 X 内部 API `POST /i/api/1.1/blocks/create.json`（带从 cookie 读取的 `ct0` CSRF token + 硬编码 Bearer token）执行，强制 10 秒/个间隔、单 session 上限、遇 429 自动暂停 30 分钟、带队列/暂停/取消。

**误杀防护优先级**：本地白名单（`GM_setValue` 持久化）> 维护者黑名单精确匹配 > 启发式分数。`isWhitelisted()` 在隐藏和拉黑前都会检查，永远最高优先级。

## 治理模型（修改数据时必须遵守）

- `blocklist.json` 只能由**维护者人工审核**后加入；普通用户不通过直接 PR 改它。
- 社区提交走脚本的「提交到黑名单」按钮 → 自动生成 GitHub Issue（含 user_id、证据、检测分数）→ 维护者审核后才进 `blocklist.json`。
- 批量拉黑功能只信任 `blocklist.json`，这是降低误杀风险的核心设计——新增/修改黑名单条目时务必有 `evidence` 字段且确认是真 spam。

## 数据格式约定

- `blocklist.json`：对象数组，字段 `user_id`（首选，最稳定）、`screen_name`、`name`、`reason`、`category`、`added`（`YYYY-MM-DD`）、`evidence`。`category` 取值：`寻固炮` / `色情引流` / `诈骗` / `其他`。当前文件含 `placeholder_*` 示例数据，尚未填入真实账号。
- `spam-keywords.txt`：每行一个关键词，`#` 开头为注释。**形似字混淆**很重要——`曰p` 与 `日p`、`曰P` 与 `日P` 都要分别收录（spammer 用形近字绕过过滤）。脚本目前未做字符归一化，所以变体必须各自列出。

## 修改脚本时的注意事项

- 改 `userscript/*.user.js` 时记得同步 bump `// @version`（Tampermonkey 据此自动更新），并保持 `FALLBACK_KEYWORDS`（远程加载失败时的兜底）与 `spam-keywords.txt` 大致一致。
- 新增需要访问的外部域名时，要在脚本头部加 `// @connect`。
- DOM 选择器依赖 X 当前的 `data-testid`（`tweet`、`UserCell`、`tweetText`、`User-Name`）——X 改版会导致提取失效，这是最脆弱的部分。
- `docs/installation.md` 与脚本现状有出入（文档写 8 秒/「拉黑可见 spam」，脚本实际是 10 秒/「从维护者黑名单拉黑」）——以脚本代码为准，改动行为时一并更新文档。

## 测试与运行

无自动化测试。验证方式是手动安装到 Tampermonkey 后在 x.com 上观察右下角控制面板。修改 JSON 后可用 `python3 -m json.tool blocklist/blocklist.json` 检查语法是否合法。
