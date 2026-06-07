import { spawn } from "node:child_process";
import { NextRequest } from "next/server";
import { REPO_ROOT, normalizeUrl, slugFromUrl } from "@/lib/paths";
import { readResult } from "@/lib/read-result";
import { slugFromOutput } from "../capture/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * Capture có streaming: trả NDJSON, mỗi dòng là một event.
 *  {"type":"log","line":"…"}   — từng dòng stdout của CLI
 *  {"type":"result", …payload} — kết quả cuối
 *  {"type":"error","error":"…"}
 */
export async function POST(req: NextRequest) {
  let url: string;
  try {
    ({ url } = await req.json());
  } catch {
    return new Response('{"type":"error","error":"Body JSON không hợp lệ"}\n', {
      status: 400,
    });
  }
  if (!url || typeof url !== "string") {
    return new Response('{"type":"error","error":"Thiếu url"}\n', { status: 400 });
  }

  const normalized = normalizeUrl(url);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      const child = spawn("npm", ["run", "capture", "--", normalized], {
        cwd: REPO_ROOT,
        shell: true,
      });

      let out = "";
      let err = "";
      let buf = "";

      child.stdout.on("data", (d) => {
        const text = d.toString();
        out += text;
        buf += text;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) send({ type: "log", line });
        }
      });
      child.stderr.on("data", (d) => (err += d.toString()));
      child.on("error", (e) => {
        send({ type: "error", error: e.message });
        controller.close();
      });
      child.on("close", async (code) => {
        if (buf.trim()) send({ type: "log", line: buf });
        if (code !== 0) {
          send({ type: "error", error: err || `capture exited with code ${code}` });
          controller.close();
          return;
        }
        try {
          const slug = slugFromOutput(out, slugFromUrl(normalized));
          const payload = await readResult(slug);
          send({ type: "result", ...payload });
        } catch (e) {
          send({ type: "error", error: (e as Error).message });
        }
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
