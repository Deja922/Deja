interface SessionSnapshot {
  requests: number;
  compressed: number;
  skipped: number;
  passthrough: number;
  totalOriginalTokens: number;
  totalOutputTokens: number;
  startTime: number;
  port?: number;
  upstreamOk?: boolean | null;
  retryCount?: number;
  mode?: string;
  targetTokens?: number;
  maxTokens?: number;
  compressThreshold?: number;
  lastRequestTokens?: number;
  lastRequestCompressed?: boolean | null;
  licenseMonthlyUsage?: number;
  licenseMonthlyLimit?: number | null;
  licenseLimitReached?: boolean;
  licenseTier?: string;
  licenseEmail?: string;
  licenseExpiry?: number;
}

export function renderDashboard(s: SessionSnapshot): string {
  const uptime = Math.round((Date.now() - s.startTime) / 1000);
  const saved = s.totalOriginalTokens - s.totalOutputTokens;
  const pct = s.totalOriginalTokens > 0
    ? Math.round((1 - s.totalOutputTokens / s.totalOriginalTokens) * 100)
    : 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deja Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0d1117; color: #c9d1d9; padding: 2rem;
  }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; color: #58a6ff; }
  .subtitle { color: #8b949e; margin-bottom: 2rem; font-size: 0.875rem; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }
  .card {
    background: #161b22; border: 1px solid #30363d;
    border-radius: 8px; padding: 1.25rem;
  }
  .card .value { font-size: 2rem; font-weight: 700; color: #f0f6fc; }
  .card .label { font-size: 0.8rem; color: #8b949e; margin-top: 0.25rem; }
  .green { color: #3fb950 !important; }
  .yellow { color: #d2991d !important; }
  .bar-wrap {
    background: #21262d; border-radius: 4px; height: 8px;
    margin-top: 1.5rem; overflow: hidden;
  }
  .bar-fill {
    background: linear-gradient(90deg, #238636, #3fb950);
    height: 100%; border-radius: 4px; transition: width 0.5s;
  }
  .footer {
    margin-top: 2rem; color: #8b949e; font-size: 0.75rem;
    border-top: 1px solid #21262d; padding-top: 1rem;
  }
  table {
    width: 100%; border-collapse: collapse;
    margin-top: 1.5rem;
  }
  th, td {
    text-align: left; padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #21262d; font-size: 0.875rem;
  }
  th { color: #8b949e; font-weight: 500; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 12px;
    font-size: 0.75rem; font-weight: 600;
  }
  .badge-ok { background: #23863633; color: #3fb950; }
  .badge-info { background: #1f6feb33; color: #58a6ff; }
  .badge-warn { background: #9e6a0333; color: #d2991d; }
  .badge-danger { background: #da363333; color: #f85149; }
  .banner {
    border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 2rem;
    display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
  }
  .banner-limit {
    background: #2d1a1a; border: 1px solid #f8514966;
    color: #f85149;
  }
  .banner a { color: #58a6ff; text-decoration: underline; }
  .usage-bar-wrap {
    background: #21262d; border-radius: 4px; height: 8px;
    margin-top: 0.5rem; overflow: hidden; width: 100%;
  }
  .usage-bar-fill {
    height: 100%; border-radius: 4px; transition: width 0.5s;
  }
</style>
</head>
<body>
  <h1>Deja Context Engine</h1>
  <p class="subtitle">Context compression proxy — ${s.upstreamOk === false ? "degraded (upstream unreachable)" : "running"} &middot; Mode: <span class="badge badge-${s.mode === "demo" ? "info" : s.mode === "aggressive" ? "info" : "ok"}">${(s.mode ?? "production").toUpperCase()}</span></p>

  ${s.licenseLimitReached ? `
  <div class="banner banner-limit">
    <span style="font-size:1.5rem;">🔒</span>
    <div>
      <strong>免费版已达月限（${s.licenseMonthlyUsage ?? 0} / ${s.licenseMonthlyLimit ?? 100} 次）</strong><br>
      <span style="font-size:0.85rem;">本月压缩次数已用完，后续请求将直接透传。运行 <code>deja license:activate &lt;key&gt;</code> 激活 Pro 解锁无限压缩。</span>
    </div>
  </div>` : ""}

  <div class="grid">
    <div class="card">
      <div class="value">${s.requests}</div>
      <div class="label">Total Requests</div>
    </div>
    <div class="card">
      <div class="value green">${s.compressed}</div>
      <div class="label">Compressed</div>
    </div>
    <div class="card">
      <div class="value yellow">${s.skipped}</div>
      <div class="label">Skipped (below threshold)</div>
    </div>
    <div class="card">
      <div class="value">${s.passthrough}</div>
      <div class="label">Passthrough</div>
    </div>
    <div class="card">
      <div class="value green">${saved.toLocaleString()}</div>
      <div class="label">Tokens Saved</div>
    </div>
    <div class="card">
      <div class="value">${pct}%</div>
      <div class="label">Compression Ratio</div>
    </div>
    <div class="card">
      <div class="value ${s.licenseLimitReached ? "badge-danger" : ""}" style="${s.licenseLimitReached ? "color:#f85149" : ""}">
        ${s.licenseMonthlyUsage ?? 0}${s.licenseMonthlyLimit ? " / " + s.licenseMonthlyLimit : ""}
      </div>
      <div class="label">本月压缩次数 <span class="badge ${s.licenseTier === "pro" || s.licenseTier === "team" ? "badge-ok" : "badge-info"}">${(s.licenseTier ?? "free").toUpperCase()}</span></div>
      ${s.licenseMonthlyLimit ? `
      <div class="usage-bar-wrap">
        <div class="usage-bar-fill" style="width:${Math.min(Math.round(((s.licenseMonthlyUsage ?? 0) / s.licenseMonthlyLimit) * 100), 100)}%; background:${s.licenseLimitReached ? "#f85149" : "#238636"}"></div>
      </div>` : ""}
    </div>
  </div>

  <div class="bar-wrap">
    <div class="bar-fill" style="width:${Math.min(pct, 100)}%"></div>
  </div>

  <table>
    <tr>
      <th>Metric</th><th>Value</th>
    </tr>
    <tr>
      <td>Uptime</td>
      <td>${uptime}s</td>
    </tr>
    <tr>
      <td>Original tokens</td>
      <td>${s.totalOriginalTokens.toLocaleString()}</td>
    </tr>
    <tr>
      <td>Output tokens</td>
      <td>${s.totalOutputTokens.toLocaleString()}</td>
    </tr>
    <tr>
      <td>Status</td>
      <td><span class="badge ${s.upstreamOk === false ? "badge-info" : "badge-ok"}">${s.upstreamOk === false ? "DEGRADED" : "RUNNING"}</span></td>
    </tr>
    <tr>
      <td>Upstream</td>
      <td>${s.upstreamOk === false ? '<span class="badge badge-info">UNREACHABLE</span>' : s.upstreamOk === true ? '<span class="badge badge-ok">REACHABLE</span>' : '<span class="badge badge-info">CHECKING</span>'}</td>
    </tr>
    <tr>
      <td>Retries</td>
      <td>${s.retryCount ?? 0}</td>
    </tr>
    <tr>
      <td>Endpoint</td>
      <td><span class="badge badge-info">http://localhost:${s.port ?? 9090}</span></td>
    </tr>
    <tr>
      <td>Compression Mode</td>
      <td><span class="badge badge-ok">${(s.mode ?? "production").toUpperCase()}</span></td>
    </tr>
    <tr>
      <td>Target Tokens</td>
      <td>${(s.targetTokens ?? 4000).toLocaleString()}</td>
    </tr>
    <tr>
      <td>Max Tokens (ceiling)</td>
      <td>${(s.maxTokens ?? 8000).toLocaleString()}</td>
    </tr>
    <tr>
      <td>Compress Threshold</td>
      <td>${(s.compressThreshold ?? 200).toLocaleString()} tok</td>
    </tr>
    ${s.lastRequestCompressed !== null ? `
    <tr>
      <td>Last Request</td>
      <td>${s.lastRequestCompressed
        ? `<span class="badge badge-ok">COMPRESSED</span> ${(s.lastRequestTokens ?? 0).toLocaleString()} tok`
        : `<span class="badge badge-info">SKIPPED</span> ${(s.lastRequestTokens ?? 0).toLocaleString()} tok &lt; ${(s.compressThreshold ?? 200)} tok`
      }</td>
    </tr>` : ""}
    <tr>
      <td>License</td>
      <td>
        <span class="badge ${s.licenseTier === "pro" || s.licenseTier === "team" ? "badge-ok" : "badge-info"}">${(s.licenseTier ?? "FREE").toUpperCase()}</span>
        ${s.licenseEmail ? `&nbsp;<span style="color:#8b949e;font-size:0.8rem">${s.licenseEmail}</span>` : ""}
        ${s.licenseExpiry ? `&nbsp;<span style="color:#8b949e;font-size:0.8rem">到期 ${new Date(s.licenseExpiry).toLocaleDateString("zh-CN")}</span>` : ""}
      </td>
    </tr>
    <tr>
      <td>本月用量</td>
      <td>${s.licenseMonthlyUsage ?? 0} / ${s.licenseMonthlyLimit != null ? s.licenseMonthlyLimit + " 次" : "无限制"}
        ${s.licenseLimitReached ? '&nbsp;<span class="badge badge-danger">已达上限</span>' : ""}
      </td>
    </tr>
  </table>

  <div style="margin-top:2rem; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:1.25rem;">
    <h3 style="color:#58a6ff; margin-bottom:0.5rem;">Why is compression skipped for small contexts?</h3>
    <p style="font-size:0.85rem; color:#8b949e; line-height:1.5;">
      Compression is only triggered when the context size exceeds the <strong>compressThreshold</strong> (${s.compressThreshold ?? 200} tokens in ${s.mode ?? "production"} mode).
      For small requests below this threshold, compression adds latency without meaningful token savings.
      Skipping compression on small contexts <strong>improves response quality</strong> (no information loss from summarization)
      and <strong>reduces latency</strong> (no processing overhead). As conversations grow and context accumulates beyond the threshold,
      Deja automatically compresses to keep you within the token budget.
    </p>
  </div>

  <div class="footer">
    Deja v0.1.4 &middot; <span id="countdown">自动刷新中...</span>
  </div>
<script>
  let t = 5;
  const el = document.getElementById('countdown');
  setInterval(() => {
    t--;
    if (t <= 0) { location.reload(); }
    else { el.textContent = t + '秒后自动刷新'; }
  }, 1000);
</script>
</body>
</html>`;
}
