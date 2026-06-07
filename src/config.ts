import path from "node:path";

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export const viewports: Viewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

/** Thư mục gốc chứa output (output/<domain-slug>/...) */
export const OUTPUT_ROOT = path.resolve(process.cwd(), "output");

/** Chờ tối đa khi load trang (ms) */
export const NAV_TIMEOUT = 45_000;

/** Số bước cuộn tối đa khi auto-scroll để lazy-load */
export const MAX_SCROLL_STEPS = 40;

/** User-agent giống Chrome desktop để tránh bị chặn cơ bản */
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Đường dẫn output cho một capture */
export function buildPaths(slug: string) {
  const base = path.join(OUTPUT_ROOT, slug);
  return {
    base,
    screenshots: path.join(base, "screenshots"),
    snapshots: path.join(base, "snapshots"),
    analysis: path.join(base, "analysis"),
    pageHtml: path.join(base, "snapshots", "page.html"),
    metadata: path.join(base, "snapshots", "metadata.json"),
    layoutMap: path.join(base, "analysis", "layout-map.json"),
    tokensRaw: path.join(base, "analysis", "design-tokens.raw.json"),
    tokens: path.join(base, "analysis", "design-tokens.json"),
    rebuildBrief: path.join(base, "analysis", "rebuild-brief.md"),
    components: path.join(base, "analysis", "components.json"),
    aiPrompt: path.join(base, "analysis", "ai-prompt.md"),
    rebuildDir: path.join(base, "rebuild"),
  };
}

export type CapturePaths = ReturnType<typeof buildPaths>;
