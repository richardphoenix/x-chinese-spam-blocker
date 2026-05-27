# 安装与使用指南

## 1. 安装 Tampermonkey

- Chrome / Edge / Firefox：从官方商店安装 **Tampermonkey**
- 推荐使用最新版

## 2. 安装脚本

### 方法 A（推荐）
1. 打开 [userscript/x-chinese-spam-blocker.user.js](../userscript/x-chinese-spam-blocker.user.js) 原始文件
2. Tampermonkey 会自动弹出安装窗口，点击「安装」

### 方法 B
直接访问 GitHub 原始文件安装：  
https://raw.githubusercontent.com/richardphoenix/x-chinese-spam-blocker/main/userscript/x-chinese-spam-blocker.user.js

## 3. 使用方式

安装后访问 x.com，右下角会出现一个控制面板：

- **隐藏已开启**：实时隐藏匹配账号（默认开启，推荐一直开）
- **从维护者黑名单拉黑**：危险操作！只会批量拉黑维护者审核过的正式黑名单账号（带 10 秒延迟，可暂停/取消）
- **提交此账号到黑名单**：快速打开 GitHub Issue 模板，方便贡献新账号

## 4. 推荐用法

1. 日常使用只开「隐藏」即可，体验最好，也最安全
2. 偶尔看到明显 spam 时点击「提交此账号到黑名单」
3. 只有在你真的想清理的时候才使用「从维护者黑名单拉黑」，已带 10 秒间隔与单次上限

## 5. 安全提示

- X 对批量操作非常敏感，脚本已经设置了保守的 10 秒间隔
- 如果触发频率限制（429），请停止操作并等待一段时间
- 误杀的账号可以通过白名单机制或手动 unblock 恢复

## 6. 更新脚本

Tampermonkey 会自动检查更新（如果脚本头里有 `@updateURL`）。也可以手动重新安装最新版。

## 7. 反馈与贡献

- 发现 bug 或想提功能：提 Issue
- 想贡献新的 spam 账号：使用脚本里的举报按钮，或直接编辑 `blocklist/blocklist.json` 提 PR
