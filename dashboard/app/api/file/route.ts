import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { safeFile } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".css": "text/plain; charset=utf-8",
  ".cjs": "text/plain; charset=utf-8",
};

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  const rel = req.nextUrl.searchParams.get("path");
  if (!slug || !rel) {
    return NextResponse.json({ error: "Thiếu slug/path" }, { status: 400 });
  }

  let file: string;
  try {
    file = safeFile(slug, rel);
  } catch {
    return NextResponse.json({ error: "Đường dẫn không hợp lệ" }, { status: 400 });
  }

  try {
    const buf = await fs.readFile(file);
    const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
    const download = req.nextUrl.searchParams.get("download") === "1";
    const headers: Record<string, string> = {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
    };
    if (download) {
      headers["Content-Disposition"] =
        `attachment; filename="${rel.split("/").pop()}"`;
    }
    return new NextResponse(new Uint8Array(buf), { headers });
  } catch {
    return NextResponse.json({ error: "Không tìm thấy file" }, { status: 404 });
  }
}
