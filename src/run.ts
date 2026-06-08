import fs from "fs-extra";
import slugify from "slugify";
import { chromium, Browser } from "playwright";
import { buildPaths, CapturePaths, viewports } from "./config.js";
import {
  captureNonDesktopScreenshots,
  openStablePage,
  PageMetadata,
  saveSnapshot,
  screenshotPage,
} from "./capture.js";
import { LayoutMap, measureSectionColumns, scrapeDom } from "./scrape-dom.js";
import { scrapeColorScheme, scrapeCss } from "./scrape-css.js";
import { clusterTokens, DesignTokens } from "./cluster-tokens.js";
import { generateBrief } from "./report.js";
import { ComponentTree, generateComponents } from "./generate.js";
import { generateCode } from "./codegen.js";
import { generateHtml } from "./codegen-html.js";
import { auditAccessibility } from "./audit.js";

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

/**
 * Chạy toàn bộ pipeline Phase 1–6 cho một URL. Dùng chung bởi CLI và dashboard.
 * `sharedBrowser`: truyền vào để batch tái dùng 1 browser (không tự đóng).
 */
export async function runCapture(
  rawUrl: string,
  log: (msg: string) => void = console.log,
  sharedBrowser?: Browser
): Promise<CaptureResult> {
  const url = normalizeUrl(rawUrl);
  const slug = slugFromUrl(url);
  const paths = buildPaths(slug);

  log(`🌐 Capture: ${url}`);
  log(`📁 Output:  ${paths.base}`);

  await fs.ensureDir(paths.screenshots);
  await fs.ensureDir(paths.snapshots);
  await fs.ensureDir(paths.analysis);

  const browser = sharedBrowser ?? (await chromium.launch({ headless: true }));
  try {
    log("📸 Phase 1 — Screenshots (tablet + mobile)");
    await captureNonDesktopScreenshots(browser, url, paths);

    // Desktop: mở MỘT page rồi tái dùng cho cả screenshot lẫn snapshot/DOM/CSS
    // → bớt một lần full-load + autoScroll so với mở riêng.
    const desktop = viewports.find((v) => v.name === "desktop")!;
    const page = await openStablePage(browser, url, desktop);
    try {
      await screenshotPage(page, "desktop", paths);

      const meta = await saveSnapshot(page, url, paths);

      log("🧱 Phase 2 — DOM structure");
      const layout = await scrapeDom(page, paths);

      log("🎨 Phase 3 — Computed CSS + clustering");
      const raw = await scrapeCss(page, paths);

      log("♿ Phase 7 — Accessibility audit");
      await auditAccessibility(page, paths);

      // Đo lại màu ở chế độ dark (emulateMedia, không reload) để bắt palette dark nếu site có.
      let darkColors;
      try {
        await page.emulateMedia({ colorScheme: "dark" });
        await page.waitForTimeout(400);
        darkColors = await scrapeColorScheme(page);
        await page.emulateMedia({ colorScheme: "light" });
      } catch {
        /* trang lạ — bỏ qua dark */
      }
      const tokens = await clusterTokens(raw, paths, darkColors);

      // Đo số cột thật ở tablet/mobile (resize cùng page → align theo index với desktop).
      try {
        const tablet = viewports.find((v) => v.name === "tablet")!;
        const mobile = viewports.find((v) => v.name === "mobile")!;
        await page.setViewportSize({ width: tablet.width, height: tablet.height });
        await page.waitForTimeout(350);
        const tabletCols = await measureSectionColumns(page);
        await page.setViewportSize({ width: mobile.width, height: mobile.height });
        await page.waitForTimeout(350);
        const mobileCols = await measureSectionColumns(page);
        await page.setViewportSize({ width: desktop.width, height: desktop.height });
        layout.sections.forEach((s, i) => {
          if (tabletCols[i]) s.layout.columnsTablet = tabletCols[i];
          if (mobileCols[i]) s.layout.columnsMobile = mobileCols[i];
        });
        await fs.writeJSON(paths.layoutMap, layout, { spaces: 2 });
      } catch {
        /* responsive đo lỗi — vẫn dùng heuristic */
      }

      log("📝 Report");
      await generateBrief(meta, layout, tokens, paths);

      log("🤖 Phase 4 — Components + AI prompt");
      const components = await generateComponents(meta, layout, tokens, paths);

      log("⚙️  Phase 6 — Code generator (Next.js + Tailwind)");
      const imgMap = await generateCode(meta, tokens, components, paths);

      log("📄 Phase 6b — Code generator (vanilla HTML + CSS + JS)");
      await generateHtml(meta, tokens, components, paths, imgMap);

      return { url, slug, paths, meta, layout, tokens, components };
    } finally {
      await page.context().close();
    }
  } finally {
    if (!sharedBrowser) await browser.close();
  }
}
