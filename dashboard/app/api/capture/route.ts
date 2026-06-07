import { spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { REPO_ROOT, normalizeUrl, slugFromUrl } from "@/lib/paths";
import { readResult } from "@/lib/read-result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

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

export async function POST(req: NextRequest) {
  let url: string;
  try {
    ({ url } = await req.json());
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Thiếu url" }, { status: 400 });
  }

  const normalized = normalizeUrl(url);
  let slug = slugFromUrl(normalized);
  try {
    const out = await runCli(normalized);
    slug = slugFromOutput(out, slug);
  } catch (e) {
    return NextResponse.json(
      { error: `Capture lỗi: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  return NextResponse.json(await readResult(slug));
}
