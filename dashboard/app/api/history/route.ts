import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { OUTPUT_ROOT } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liệt kê các lần capture đã có trong output/. */
export async function GET() {
  let dirs: string[] = [];
  try {
    const entries = await fs.readdir(OUTPUT_ROOT, { withFileTypes: true });
    dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return NextResponse.json({ items: [] });
  }

  const items = await Promise.all(
    dirs.map(async (slug) => {
      let meta: { title?: string; url?: string; finalUrl?: string; capturedAt?: string } = {};
      try {
        meta = JSON.parse(
          await fs.readFile(
            path.join(OUTPUT_ROOT, slug, "snapshots", "metadata.json"),
            "utf-8"
          )
        );
      } catch {
        /* folder chưa có metadata */
      }
      return {
        slug,
        title: meta.title ?? slug,
        url: meta.finalUrl ?? meta.url ?? "",
        capturedAt: meta.capturedAt ?? null,
      };
    })
  );

  items.sort((a, b) => (b.capturedAt ?? "").localeCompare(a.capturedAt ?? ""));
  return NextResponse.json({ items });
}
