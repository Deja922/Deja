# 常见问题

## 基础概念

### Deja 是什么？

Deja 是一个本地代理，运行在你的电脑上，在 Claude Code 和 AI API 之间充当中转。它会自动压缩对话历史，减少每次请求发送的 token 数量，从而节省 API 费用。

### Deja 会看我的代码吗？

Deja 运行在你本地，所有数据只经过你的电脑。Deja 不收集、不上传、不存储任何对话内容到外部服务器。

### Deja 会影响 AI 回复质量吗？

实测结果显示压缩后回复质量反而略有提升（8.2 vs 7.4 分）。因为 Deja 去除了重复和无关内容后，AI 能更专注于真正重要的上下文。

---

## 价格与费用

### Deja 收费吗？

Deja 完全免费，MIT 开源协议。

### 使用 Deja 能省多少钱？

在 20 轮的长对话中，Deja 可以减少约 71% 的 prompt token 消耗。对于使用付费 API 的用户，这意味着直接降低 40-70% 的费用。

### Deja 自己会消耗 token 吗？

不会。Deja 的压缩算法完全在本地运行，不调用任何 AI API。内存模块使用的是本地 256 维哈希嵌入，也不需要外部 API。

---

## 兼容性

### Deja 支持哪些 AI 服务？

支持所有：
- Anthropic Messages API（Claude 官方 API）
- OpenAI Chat Completions API（GPT 官方 API）
- 所有兼容以上格式的中转站（API 代理）
- DeepSeek（同时支持 /anthropic 和 /v1 路径）

### Deja 支持哪些客户端？

- Claude Code（CLI）
- VS Code + Claude Code 扩展
- Cursor + Claude Code 扩展
- 任何通过 `ANTHROPIC_BASE_URL` 配置的工具

### 需要什么 Node.js 版本？

Node.js 18 或更高版本。推荐 20.x LTS。

---

## 使用方式

### 每次开机都需要重新启动 Deja 吗？

是的。Deja 目前不会自动启动。每次开机后运行：

```bash
deja start --upstream https://你的API地址
```

建议保留 Deja 运行的终端窗口。

### 可以同时使用多个 Deja 实例吗？

可以，每个实例需要使用不同的端口：

```bash
deja start --port 9090 --upstream https://api.anthropic.com
deja start --port 9091 --upstream https://api.openai.com
```

### 压缩模式怎么选？

- 日常使用：`production`（默认）— 平衡效果和保留度
- 超长对话：`balanced` 或 `aggressive` — 更激进的压缩
- 短对话/测试：不需要调整，短对话会自动跳过压缩

### 可以为不同项目用不同的上游吗？

可以。在每个项目目录下使用不同的终端窗口，启动不同配置的 Deja：

```bash
# 终端 1 — 项目 A 使用 DeepSeek
deja start --port 9090 --upstream https://api.deepseek.com/anthropic

# 终端 2 — 项目 B 使用 OpenAI
deja start --port 9091 --upstream https://api.openai.com
```

然后在对应项目的 Claude Code 中配置对应端口。

---

## 安全与隐私

### Deja 会存储我的 API Key 吗？

不会。Deja 不会将 API Key 写入任何文件。API Key 通过环境变量读取，只在转发请求时附加到 HTTP Header 中。

### 备份文件里有什么？

`deja install` 创建的备份文件是你原本的 `settings.json` 的完整复制。里面可能包含你的 API 配置信息。建议不要分享备份文件。

### 卸载后还有残留文件吗？

运行 `deja uninstall` 后，配置文件已还原。以下目录可以手动删除（不影响系统）：
- `~/.deja/` — Deja 日志和缓存

---

## 运行问题

### "Upstream may be unreachable" 是什么意思？

Deja 在启动时会测试上游 API 的连接。如果返回这个警告，可能是：
1. 你的网络无法直接访问该地址
2. 该地址的根路径（`/`）不响应请求（这是正常的，很多 API 只响应特定路径）
3. 需要 VPN 或代理才能访问

**这不影响使用**。Deja 会继续启动，实际请求时如果连接失败才会有报错。

### 为什么仪表盘显示的端口和我的配置不一样？

仪表盘始终显示当前运行的 Deja 实例的端口。如果看到不对的端口，检查你是否连接到了不同的 Deja 实例。

### 日志文件在哪里？

`~/.deja/proxy.log`

---

## 进阶

### 怎么知道压缩具体做了什么？

使用实时日志：
```bash
deja logs -f
```

每一行都是一个事件，类型包括：
- `[compress]` — 压缩执行
- `[request]` — 收到请求
- `[upstream]` — 上游错误
- `[retry]` — 重试
- `[health]` — 上游健康检查

### 可以自己调整压缩策略吗？

可以。创建 `~/.deja/config.json` 调整参数（参考 QUICKSTART.md 中的配置说明）。

### 如何报告问题？

GitHub Issues: https://github.com/Deja922/Deja/issues
