# 安装与使用指南

## 1. 安装 Tampermonkey

Chrome / Edge / Firefox 从官方商店安装 **[Tampermonkey](https://www.tampermonkey.net/)**（推荐最新版）。

## 2. 安装脚本（一键）

点击安装 👉 **https://raw.githubusercontent.com/richardphoenix/x-chinese-spam-blocker/main/userscript/x-chinese-spam-blocker.user.js**

Tampermonkey 会识别 `.user.js` 并弹出安装窗口，点「安装」即可。**从这个链接安装**，以后能自动更新（见第 6 节）。

> 如果你是手动复制粘贴安装：在 Tampermonkey「Create a new script」里先 **Cmd/Ctrl+A 全选删空默认模板**，再粘贴完整脚本，然后保存——否则会有两个 `==UserScript==` 头导致不生效。

## 3. ⚠️ 让脚本能在页面上运行（Chrome/Edge MV3 必看）

新版 Chrome/Edge 默认不给用户脚本页面权限，会显示「Tampermonkey has no access to this page」，脚本不会执行。修复：

1. 地址栏进 `chrome://extensions`
2. 打开右上角 **开发者模式（Developer mode）**
3. 进入 Tampermonkey 的 **Details** → 打开 **Allow User Scripts**（如有），**Site access** 选 **On all sites / 所有网站**
4. 回到 x.com **刷新页面**

弄完右下角会出现控制面板。

## 4. 控制面板功能

- **隐藏已开启 / 已关闭**：实时隐藏匹配黑名单或关键词的账号，折叠成一条细栏（默认开启，推荐一直开）。每条细栏可「显示」展开复查、「误杀→加白名单」一键救回。
- **提交全部隐藏账号**：把本次隐藏的账号一次性提交到审核队列（自动解析 user_id，服务端去重）。
- **从维护者黑名单拉黑**：危险操作，只批量拉黑维护者审核过的正式黑名单账号（10 秒/个，可暂停/取消）。
- 底部三个**可点击**的计数，点开是列表：
  - **正式黑名单**：当前订阅到的已审核账号（只读）。
  - **本次隐藏**：本次被隐藏的推文（看内容判断是否误杀，可逐条「恢复并加白」）。
  - **本地白名单**：你加白的账号（可移除）。

## 5. 推荐用法

1. 日常只开「隐藏」即可，体验最好也最安全。
2. 看到一批 spam 后点「提交全部隐藏账号」帮社区补充黑名单。
3. 想清理关注/时间线时再用「从维护者黑名单拉黑」，已带 10 秒间隔与单次上限。
4. 发现误杀（点开「本次隐藏」复查）→「恢复并加白」，以后不再隐藏该账号。

## 6. 自动更新

脚本头含 `@updateURL` / `@downloadURL`，从 raw 链接安装后 Tampermonkey 会自动检查更新。如未生效：
- Dashboard → **Settings** → 把「Script Update Check Interval」设为 **Every day** 等；
- 单脚本 → **Settings** → **Updates** 确认开启；
- 想立刻拉最新：Dashboard → **Check for userscript updates**。
（GitHub raw 有约 5 分钟 CDN 缓存，发版后不是秒更。）

## 7. 安全提示

- X 对批量操作敏感，脚本已设保守的 10 秒间隔；触发频率限制（429）请停手等待。
- 隐藏只是折叠、可随时恢复；误杀可加本地白名单，或手动 unblock。

## 8. 反馈与贡献

- Bug / 功能建议：提 Issue。
- 贡献 spam 账号：用面板「提交全部隐藏账号」（进审核队列，维护者通过后写入黑名单），或直接编辑 `blocklist/blocklist.json` 提 PR。
