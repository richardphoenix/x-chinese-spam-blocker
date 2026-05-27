# X 中文 Spam 黑名单

本目录存放针对中文 X 平台的 spam 账号黑名单，主要针对“寻固炮”及其变种的诈骗/引流机器人。

## 文件说明

- `blocklist.json`：主黑名单，推荐使用 user_id（最稳定）
- `spam-keywords.txt`：辅助关键词，用于启发式检测新账号

## blocklist.json 格式

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

## 贡献规则（重要）

**正式黑名单维护原则**：
- `blocklist.json` 仅包含**维护者确认**的账号
- 普通用户**不能直接**通过 PR 修改正式黑名单
- 社区用户可以通过脚本「提交到黑名单数据库」功能提交账号

**提交流程**：
1. 用户在 X 上看到 spam 账号时，点击脚本的「提交到黑名单数据库」按钮
2. 系统会自动打开 GitHub Issue（包含 user_id、截图证据、检测原因）
3. 维护者审核后，决定是否合并到 `blocklist.json`
4. 审核通过的账号才会出现在脚本的**批量拉黑**功能中

这样设计可以最大程度避免误杀，同时让社区参与贡献。

## 贡献规则（维护者审核标准）

1. 必须提供证据（截图或链接）
2. 仅收录明显批量 spam / 诈骗引流账号
3. 误杀账号可通过 Issue 快速移除
4. 优先使用 user_id，screen_name 仅作参考
5. 社区提交默认进入待审核状态，需人工确认后才进入正式黑名单

## 分类建议

- `寻固炮`：使用“寻固炮 / 固炮 / 找固搭”等话术的账号
- `色情引流`：其他低俗引流
- `诈骗`：明确要红包、投资、虚拟币等诈骗
- `其他`

## 数据使用

该黑名单供 `x-chinese-spam-blocker` 油猴脚本订阅使用。

仓库地址：https://github.com/richardphoenix/x-chinese-spam-blocker
也欢迎其他工具作者使用（请注明来源）。
