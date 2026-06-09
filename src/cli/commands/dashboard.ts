import { exec } from "child_process";

interface DashboardOptions {
  port: number;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;

  if (platform === "win32") {
    cmd = `start "" "${url}"`;
  } else if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      console.log(`  Could not open browser automatically.`);
      console.log(`  Open this URL in your browser:`);
      console.log(`  ${url}`);
    }
  });
}

export async function dashboard(opts: DashboardOptions): Promise<void> {
  const url = `http://localhost:${opts.port}/__deja__`;

  console.log("");
  console.log("  Deja Dashboard");
  console.log("  ──────────────");
  console.log(`  Opening ${url} ...`);
  console.log("");

  openBrowser(url);
}
