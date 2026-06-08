import { spawn } from "node:child_process";
import { REPO_ROOT } from "./paths";

/** Chạy lại CLI capture trong repo gốc và chờ hoàn tất; trả stdout. */
export function runCli(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "capture", "--", url], {
      cwd: REPO_ROOT,
      shell: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err || out || `capture exited with code ${code}`));
    });
  });
}

/** slug chuẩn = segment cuối của đường "📁 Output: …/output/<slug>" CLI in ra. */
export function slugFromOutput(out: string, fallback: string): string {
  const m = out.match(/output[\\/]([^\\/\r\n]+)/);
  return m ? m[1].trim() : fallback;
}
