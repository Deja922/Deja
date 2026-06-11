# 常见问题排查

## Claude Code 提示 "Connection refused" 或连接失败

这是最常见的问题，表示 Claude Code 无法连接到 Deja 代理。

**诊断步骤：**

```bash
deja doctor
```

**常见原因和解决方法：**

### 1. Deja 没有启动

```bash
deja start --upstream https://你的API地址
```

Windows 用户需要注意：
- Deja 在终端窗口里运行，关闭窗口会停止代理
- 建议保持 Deja 运行的终端窗口打开
- 每次开机后需要重新启动 Deja

### 2. 端口被占用

错误信息：`FAIL Port 9090 is already in use`

**解决方法：**
```bash
# 检查是否已经有一个 Deja 在运行
deja status

# 如果已经运行，不需要再启动
# 如果没有运行但端口被其他程序占用，换个端口：
deja start --port 9091
deja install --port 9091   # 更新配置到新端口
```

### 3. API Key 未设置

错误信息：上游返回 401 或认证失败

```powershell
# PowerShell
$env:ANTHROPIC_API_KEY = "你的Key"

# 验证是否设置成功
echo $env:ANTHROPIC_API_KEY
```

### 4. 上游 API 地址不正确

使用 `deja doctor` 检查上游连接状态。

常见中转站地址格式：
```
DeepSeek (Anthropic 格式): https://api.deepseek.com/anthropic
DeepSeek (OpenAI 格式):    https://api.deepseek.com/v1
OpenAI 官方:               https://api.openai.com
Anthropic 官方:             https://api.anthropic.com
```

如果中转站需要自定义路径（如 `/v1/chat/completions`），请在地址中完整填写。
Deja 会自动追加 API 端点路径。

---

## 压缩似乎没有生效

Deja 的压缩在上下文超过 200 token 时才会触发（production 模式）。

**检查方法：**
```bash
deja logs -f
```

发起一个较长的 Claude Code 对话，观察日志中是否有压缩记录：
```
[compress]  14264->7164tok -50%
```

如果看到 `[compress]`，说明压缩正在工作。
如果一直看到 `passthrough`，说明上下文还没达到触发阈值，这是正常的。

---

## Windows 特定问题

### PowerShell 执行策略

如果运行 npm 命令时报 "无法加载文件" 或 "running scripts is disabled"：

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 路径中的空格

确保在纯英文路径下操作，某些工具对中文路径支持不好。

### 终端乱码

PowerShell 默认编码是 GBK，可能导致中文显示异常。可以切换到 Windows Terminal 或：
```powershell
chcp 65001   # 切换到 UTF-8
```

---

## API 相关错误

### 401 Unauthorized

API Key 错误或已过期。检查：
1. 你的 API Key 是否正确复制（没有多余空格）
2. API Key 是否还有余额
3. 中转站的 Key 格式要求

### 403 Forbidden

可能原因：
1. API Key 没有对应模型的权限
2. 中转站需要特定的 HTTP Header（联系中转站提供商确认）

### 502 Bad Gateway / Upstream unreachable

上游 API 无法连接。检查：
1. 网络是否能访问该地址：`curl https://你的API地址`
2. 是否需要代理/VPN 才能访问
3. 中转站是否在维护

---

## 配置修复

### 手动还原 Claude Code 配置

如果 `deja uninstall` 不生效：

1. 找到配置文件：
   - Windows: `C:\Users\你的用户名\.claude\settings.json`
   - macOS: `~/Library/Application Support/Claude/settings.json`

2. 删除 `ANTHROPIC_BASE_URL` 这一行（在顶层或 `env` 对象内）

3. 或者恢复 Deja 创建的备份文件：
   - 备份文件与配置文件在同一目录，名为 `settings.json.backup-时间戳`

### 重置所有 Deja 配置

```bash
# 完全卸载
deja uninstall

# 删除 Deja 数据
# Windows:
Remove-Item -Recurse -Force ~/.deja

# macOS/Linux:
rm -rf ~/.deja
```

---

## 验证 Deja 是否正常工作

完整验证流程：

```bash
# 1. 确认代理在运行
deja status

# 2. 确认配置正确
deja doctor

# 3. 确认上游连通
curl http://localhost:9090/health

# 4. 查看实时日志
deja logs -f

# 5. 在 Claude Code 中发起对话，观察日志输出
```

---

## 更新 Deja

```bash
npm update -g deja-context
```

更新后需要重启 Deja：
1. 在运行 Deja 的终端按 `Ctrl+C` 停止
2. 重新运行 `deja start --upstream 你的地址`

---

## 获取更多帮助

- 运行 `deja doctor` 获取完整诊断
- 查看 [FAQ.md](./FAQ.md) 了解常见概念问题
- GitHub Issues: https://github.com/Deja922/Deja/issues
