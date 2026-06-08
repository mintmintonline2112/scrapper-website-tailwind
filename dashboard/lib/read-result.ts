import fs from "node:fs/promises";
import path from "node:path";
import { outputDir } from "./paths";

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
}
async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf-8");
  } catch {
    return null;
  }
}

/** Liệt kê đệ quy các file trong rebuild/ (đường dẫn tương đối, dùng "/"). */
async function listRebuild(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(abs: string, rel: string) {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(abs, e.name), childRel);
      else out.push(childRel);
    }
  }
  await walk(dir, "");
  return out.sort();
}

const SCREENSHOTS = ["desktop", "tablet", "mobile"].flatMap((v) => [
  `${v}-full.png`,
  `${v}-above-fold.png`,
]);

/** Đọc toàn bộ artifact của một slug đã capture (không chạy lại pipeline). */
export async function readResult(slug: string) {
  const dir = outputDir(slug);
  const a = (f: string) => path.join(dir, "analysis", f);
  const meta = await readJson<{ url?: string; finalUrl?: string }>(
    path.join(dir, "snapshots", "metadata.json")
  );
  return {
    slug,
    url: meta?.finalUrl || meta?.url || slug,
    meta,
    layout: await readJson(a("layout-map.json")),
    tokens: await readJson(a("design-tokens.json")),
    components: await readJson(a("components.json")),
    rebuildBrief: await readText(a("rebuild-brief.md")),
    aiPrompt: await readText(a("ai-prompt.md")),
    accessibility: await readJson(a("accessibility.json")),
    screenshots: SCREENSHOTS,
    rebuildFiles: await listRebuild(path.join(dir, "rebuild")),
    rebuildHtmlFiles: await listRebuild(path.join(dir, "rebuild-html")),
  };
}
