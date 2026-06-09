interface SessionSnapshot {
  requests: number;
  compressed: number;
  skipped: number;
  passthrough: number;
  totalOriginalTokens: number;
  totalOutputTokens: number;
  startTime: number;
  upstreamOk?: boolean | null;
  retryCount?: number;
  mode?: string;
  targetTokens?: number;
  maxTokens?: number;
  compressThreshold?: number;
  lastRequestTokens?: number;
  lastRequestCompressed?: boolean | null;
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
</style>
</head>
<body>
  <h1>Deja Context Engine</h1>
  <p class="subtitle">Context compression proxy — ${s.upstreamOk === false ? "degraded (upstream unreachable)" : "running"} &middot; Mode: <span class="badge badge-${s.mode === "demo" ? "info" : s.mode === "aggressive" ? "info" : "ok"}">${(s.mode ?? "production").toUpperCase()}</span></p>

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
      <td><span class="badge badge-info">http://localhost:9090</span></td>
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
    Deja v0.1.0 &middot; Refresh to update &middot; Requests update in real time
  </div>
</body>
</html>`;
}
