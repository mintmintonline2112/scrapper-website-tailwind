import fs from "fs-extra";
import slugify from "slugify";
import { chromium } from "playwright";
import { buildPaths, CapturePaths, viewports } from "./config.js";
import {
  captureScreenshots,
  openStablePage,
  PageMetadata,
  saveSnapshot,
} from "./capture.js";
import { LayoutMap, scrapeDom } from "./scrape-dom.js";
import { scrapeCss } from "./scrape-css.js";
import { clusterTokens, DesignTokens } from "./cluster-tokens.js";
import { generateBrief } from "./report.js";
import { ComponentTree, generateComponents } from "./generate.js";
import { generateCode } from "./codegen.js";

export interface CaptureResult {
  url: string;
  slug: string;
  paths: CapturePaths;
  meta: PageMetadata;
  layout: LayoutMap;
  tokens: DesignTokens;
  components: ComponentTree;
}

export function normalizeUrl(input: string): string {
  if (!/^https?:\/\//i.test(input)) return `https://${input}`;
  return input;
}

export function slugFromUrl(url: string): string {
  const { hostname, pathname } = new URL(url);
  const host = hostname.replace(/^www\./, "");
  const pathPart = pathname.replace(/\/+$/, "").replace(/\//g, "-");
  const raw = host + pathPart;
  return slugify(raw, { lower: true, strict: true }) || "site";
}

/** Chạy toàn bộ pipeline Phase 1–4 cho một URL. Dùng chung bởi CLI và dashboard. */
export async function runCapture(
  rawUrl: string,
  log: (msg: string) => void = console.log
): Promise<CaptureResult> {
  const url = normalizeUrl(rawUrl);
  const slug = slugFromUrl(url);
  const paths = buildPaths(slug);

  log(`🌐 Capture: ${url}`);
  log(`📁 Output:  ${paths.base}`);

  await fs.ensureDir(paths.screenshots);
  await fs.ensureDir(paths.snapshots);
  await fs.ensureDir(paths.analysis);

  const browser = await chromium.launch({ headless: true });
  try {
    log("📸 Phase 1 — Screenshots");
    await captureScreenshots(browser, url, paths);

    const desktop = viewports.find((v) => v.name === "desktop")!;
    const page = await openStablePage(browser, url, desktop);
    try {
      const meta = await saveSnapshot(page, url, paths);

      log("🧱 Phase 2 — DOM structure");
      const layout = await scrapeDom(page, paths);

      log("🎨 Phase 3 — Computed CSS + clustering");
      const raw = await scrapeCss(page, paths);
      const tokens = await clusterTokens(raw, paths);

      log("📝 Report");
      await generateBrief(meta, layout, tokens, paths);

      log("🤖 Phase 4 — Components + AI prompt");
      const components = await generateComponents(meta, layout, tokens, paths);

      log("⚙️  Phase 6 — Code generator (Next.js + Tailwind)");
      await generateCode(meta, tokens, components, paths);

      return { url, slug, paths, meta, layout, tokens, components };
    } finally {
      await page.context().close();
    }
  } finally {
    await browser.close();
  }
}
