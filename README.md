# Deja — Claude Code 省钱神器

> 本地代理，自动压缩重复上下文，实测节省 40–90% token 消耗。**公测中，免费使用。**

---

## 效果

| 场景 | 节省 |
|------|------|
| 普通编码会话（10–15 轮工具调用） | 30–50% |
| 长时间连续对话（20 轮+） | 50–90% |
| 公测期间实测均值 | ~84% |

每节省 100 万 token ≈ 省 $3（Claude API 标准计费）。重度用户每月可省 $20–60。

---

## 安装

**前提：** Node.js 18+（[下载](https://nodejs.org)）

```bash
npm install -g deja-context
```

**Windows**（以管理员身份运行 PowerShell）：
```powershell
deja setup
deja service:install
deja tools:install all
```

**macOS**（Terminal）：
```bash
deja setup
deja service:install
deja tools:install all
```

安装后打开 Claude Code，右下角出现悬浮窗即为成功。

---

## 原理

Deja 在本地运行一个代理（默认端口 9090），拦截发往 Claude API 的请求：

1. 将超出最近 3 轮以外的 tool_result 内容替换为摘要
2. 丢弃重复的历史文本块
3. 上下文过长时自动切换到安全透传模式，保护对话质量

**所有处理在本地完成，API key 不经过任何第三方服务器。**

---

## 常用命令

```bash
deja status          # 查看运行状态和节省统计
deja dashboard       # 打开 Web 看板
deja logs --follow   # 实时日志
deja bypass on       # 手动暂停压缩（原样转发）
deja bypass off      # 恢复压缩
deja key:update --key NEW_KEY  # 更新 API key
deja stop            # 停止代理
```

---

## 支持的 AI 工具

| 工具 | Windows | macOS |
|------|---------|-------|
| Claude Code | ✅ | ✅ |
| Cursor | ✅ | ✅ |
| VS Code + Continue | ✅ | ✅ |
| Codex CLI | ✅ | ✅ |

---

## 公测反馈

遇到问题或有功能建议，欢迎在 [Issues](../../issues) 提交，请带上：
- 操作系统和工具名称
- `deja status` 输出
- 问题描述

---

## 卸载

```bash
deja service:remove
deja tools:uninstall all
npm uninstall -g deja-context
```

---

## License

BUSL-1.1。公测期间免费，正式收费前会提前通知。
