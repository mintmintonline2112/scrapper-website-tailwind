import archiver from "archiver";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { outputDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Đóng gói toàn bộ folder output/<slug> thành ZIP để tải về. */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "Thiếu slug" }, { status: 400 });

  let dir: string;
  try {
    dir = outputDir(slug);
    await fs.access(dir);
  } catch {
    return NextResponse.json({ error: "Không tìm thấy output" }, { status: 404 });
  }

  const archive = archiver("zip", { zlib: { level: 9 } });

  // duyệt file và thêm vào archive (đệ quy)
  async function addDir(abs: string, rel: string) {
    const entries = await fs.readdir(abs, { withFileTypes: true });
    for (const e of entries) {
      const childAbs = path.join(abs, e.name);
      const childRel = path.posix.join(rel, e.name);
      if (e.isDirectory()) await addDir(childAbs, childRel);
      else archive.append(createReadStream(childAbs), { name: childRel });
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      archive.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk)));
      archive.on("end", () => controller.close());
      archive.on("error", (err) => controller.error(err));
      addDir(dir, slug)
        .then(() => archive.finalize())
        .catch((err) => controller.error(err));
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug}.zip"`,
    },
  });
}
