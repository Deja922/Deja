import { app, BrowserWindow, ipcMain, screen, globalShortcut } from "electron";
import * as http from "http";

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

type DejaState = "running" | "bypass" | "error" | "stopped";

interface HealthData {
  status: string;
  bypass: boolean;
  upstreamOk: boolean | null;
  requests: number;
  tokensSaved: number;
  compressionPct: number;
  uptime: number;
}

let win: BrowserWindow | null = null;
let lastHealth: HealthData | null = null;
let currentState: DejaState = "stopped";

function pollHealth(): void {
  const req = http.get("http://localhost:9090/health", { timeout: 3000 }, (res) => {
    let body = "";
    res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    res.on("end", () => {
      try {
        lastHealth = JSON.parse(body) as HealthData;
        if (lastHealth.bypass) currentState = "bypass";
        else if (lastHealth.status === "degraded" || lastHealth.upstreamOk === false) currentState = "error";
        else currentState = "running";
      } catch {
        lastHealth = null;
        currentState = "stopped";
      }
      pushToRenderer();
    });
  });
  req.on("error", () => { lastHealth = null; currentState = "stopped"; pushToRenderer(); });
  req.on("timeout", () => { req.destroy(); lastHealth = null; currentState = "stopped"; pushToRenderer(); });
}

function pushToRenderer(): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("health", { state: currentState, health: lastHealth });
}

function postToProxy(apiPath: string): void {
  const req = http.request(
    { hostname: "localhost", port: 9090, path: apiPath, method: "POST", timeout: 3000 },
    () => { setTimeout(pollHealth, 300); },
  );
  req.on("error", () => {});
  req.end();
}

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:'Microsoft YaHei',system-ui,sans-serif;
  background:#1a1a2e;color:#e2e8f0;
  user-select:none;overflow:hidden;
  border-radius:12px;border:1px solid #2d3748;
}
#drag{
  -webkit-app-region:drag;
  height:38px;display:flex;align-items:center;
  padding:0 14px;background:#16213e;
  border-radius:12px 12px 0 0;gap:8px;
}
#drag .logo{font-size:14px;font-weight:700;color:#90cdf4;flex:1}
#close{
  -webkit-app-region:no-drag;
  cursor:pointer;color:#4a5568;font-size:14px;
  padding:4px 6px;border-radius:4px;line-height:1;
}
#close:hover{color:#fc8181;background:#2d3748}
#body{padding:14px}
#row{display:flex;align-items:center;gap:10px;margin-bottom:10px}
#dot{width:11px;height:11px;border-radius:50%;flex-shrink:0;transition:background .3s}
#state{font-size:14px;font-weight:600}
#stats{font-size:12px;color:#718096;line-height:1.7;margin-bottom:14px;min-height:36px}
#btns{display:flex;gap:8px}
button{
  flex:1;padding:8px 0;border:none;border-radius:7px;
  font-size:12px;cursor:pointer;font-family:inherit;
  transition:opacity .15s;font-weight:500;
}
button:hover:not(:disabled){opacity:.85}
button:disabled{opacity:.35;cursor:not-allowed}
#btn-pause{background:#2d3748;color:#e2e8f0}
#btn-dash{background:#2b6cb0;color:#fff}
#hint{font-size:11px;color:#4a5568;text-align:center;margin-top:10px}
</style>
</head>
<body>
<div id="drag">
  <span class="logo">⚡ Deja</span>
  <span id="close" title="隐藏 (Ctrl+Shift+D 重新显示)">✕</span>
</div>
<div id="body">
  <div id="row">
    <div id="dot" style="background:#4a5568"></div>
    <span id="state">连接中...</span>
  </div>
  <div id="stats">—</div>
  <div id="btns">
    <button id="btn-pause" disabled>⏸ 暂停压缩</button>
    <button id="btn-dash"  disabled>📊 Dashboard</button>
  </div>
  <div id="hint">Ctrl+Shift+D 显示/隐藏</div>
</div>
<script>
const {ipcRenderer,shell}=require('electron');
const dot=document.getElementById('dot');
const stateEl=document.getElementById('state');
const stats=document.getElementById('stats');
const btnPause=document.getElementById('btn-pause');
const btnDash=document.getElementById('btn-dash');
document.getElementById('close').onclick=()=>ipcRenderer.send('win-hide');
btnPause.onclick=()=>ipcRenderer.send('proxy-cmd',btnPause.dataset.cmd);
btnDash.onclick=()=>shell.openExternal('http://localhost:9090/__deja__');
ipcRenderer.on('health',(_,{state,health})=>{
  const C={running:'#48bb78',bypass:'#ecc94b',error:'#fc8181',stopped:'#4a5568'};
  const L={running:'运行中',bypass:'暂停中 (bypass)',error:'连接异常',stopped:'服务未运行'};
  dot.style.background=C[state];
  stateEl.textContent=L[state];
  const active=state==='running'||state==='bypass';
  btnPause.disabled=!active;
  btnDash.disabled=!active;
  btnPause.dataset.cmd=state==='bypass'?'/deja/resume':'/deja/bypass';
  btnPause.textContent=state==='bypass'?'▶ 恢复压缩':'⏸ 暂停压缩';
  if(health&&active){
    stats.innerHTML='节省 <b style="color:#90cdf4">'+(health.tokensSaved||0).toLocaleString()+'</b> tokens ('+(health.compressionPct||0)+'%)<br>请求 '+(health.requests||0)+' 次 &nbsp;|&nbsp; 运行 '+fmt(health.uptime||0);
  }else{
    stats.textContent=state==='stopped'?'代理服务未运行':'—';
  }
});
function fmt(s){if(s<60)return s+'s';if(s<3600)return Math.floor(s/60)+'m';return Math.floor(s/3600)+'h';}
</script>
</body>
</html>`;

app.whenReady().then(() => {
  app.dock?.hide();

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 280,
    height: 200,
    x: width - 296,
    y: height - 216,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);

  ipcMain.on("win-hide", () => win?.hide());
  ipcMain.on("proxy-cmd", (_, apiPath: string) => postToProxy(apiPath));

  // Ctrl+Shift+D 切换显示/隐藏
  globalShortcut.register("CommandOrControl+Shift+D", () => {
    if (!win) return;
    if (win.isVisible()) win.hide();
    else { win.show(); win.focus(); }
  });

  pollHealth();
  setInterval(pollHealth, 5000);
});

app.on("window-all-closed", () => {
  // 悬浮窗 hide 不等于 quit
});
