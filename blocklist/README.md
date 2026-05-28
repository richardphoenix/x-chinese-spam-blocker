# X 中文 Spam 黑名单

本目录存放针对中文 X 平台的 spam 账号黑名单与关键词库，主要针对「寻固炮 / 免费曰p / 想找会疼人的哥哥」等批量诈骗、引流机器人。

## 文件

- **`blocklist.json`** — 正式黑名单（user_id + 证据），维护者审核确认。userscript 每 6 小时订阅。
- **`spam-keywords.txt`** — 启发式检测关键词，userscript 加载后用于实时隐藏。维护者在审核后台直接在线编辑。
- **`submissions/`** — 社区提交流程的说明（实际待审队列存放在审核后台的 Neon 数据库,这里只保留文档与历史占位）。

## `blocklist.json` 格式

```json
[
  {
    "user_id": "1234567890123456789",
    "screen_name": "example_spam",
    "name": "张三🌸 寻固炮 🌸",
    "reason": "寻固炮 spam / 引流诈骗",
    "category": "寻固炮",
    "added": "2026-05-27",
    "evidence": "https://x.com/example_spam/status/..."
  }
]
```

字段：
- `user_id`（首选，最稳定）— X 数字 ID
- `screen_name` — @句柄
- `name` — 显示名
- `reason` / `category` — 收录原因 / 分类
- `added` — 入库日期（`YYYY-MM-DD`）
- `evidence` — 证据链接

## 提交与审核流程

1. **社区提交**：用户在 X 页面用 userscript 的「提交全部隐藏账号」按钮一键提交。请求带着 user_id（脚本自动从头像 URL 解析）、screen_name、推文内容等，POST 到审核后台 `/api/submit/batch`。
2. **待审队列**：进入 Neon 数据库 `submissions` 表，状态为 `pending`，同一 user_id 重复提交会累加票数、不重复建行。
3. **维护者审核**：在 [审核后台 `/admin`](https://x-chinese-spam-blocker.vercel.app/admin) 按票数排序看队列，逐条或批量「通过 / 拒绝」。
4. **通过即上线**：后台用维护者的 GitHub 身份把条目 commit 进 `blocklist.json`（同一 user_id 不重复追加），userscript 在下次刷新（最多 6 小时）拉到。
5. **拒绝留痕**：状态置 `rejected`，从队列隐藏，不进入黑名单。

普通用户**不**通过直接 PR 改正式黑名单；想绕过 userscript 提交也可以提 Issue 附证据。

## 维护者审核标准

1. 必须有证据（截图或链接）。
2. 只收明显批量 spam / 诈骗引流。
3. 误杀可通过 Issue 或后台快速移除。
4. 优先使用 user_id，screen_name 仅作参考。

## 分类

- `寻固炮` — 「寻固炮 / 固炮 / 找固搭」类话术
- `色情引流` — 「免费曰p / 想找会疼人的哥哥」等低俗引流
- `诈骗` — 明确要红包、投资、虚拟币
- `其他`

## 数据使用

该黑名单供 `x-chinese-spam-blocker` 油猴脚本订阅使用。仓库：https://github.com/richardphoenix/x-chinese-spam-blocker — 也欢迎其他工具作者使用（请注明来源）。
