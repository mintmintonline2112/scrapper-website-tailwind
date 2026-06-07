import fs from "fs-extra";
import type { Browser, Page } from "playwright";
import {
  CapturePaths,
  MAX_SCROLL_STEPS,
  NAV_TIMEOUT,
  USER_AGENT,
  Viewport,
  viewports,
} from "./config.js";

export interface PageMetadata {
  title: string;
  description: string;
  url: string;
  finalUrl: string;
  lang: string;
  ogImage: string;
  /** font thật được load qua @font-face (FontFaceSet) */
  webFonts: string[];
  bodyHeight: number;
  bodyWidth: number;
  capturedAt: string;
  viewports: string[];
}

/**
 * Cuộn dần xuống cuối trang để kích hoạt lazy-load (ảnh, section render khi scroll),
 * sau đó cuộn về đầu. Dừng sớm nếu chiều cao trang không tăng thêm.
 */
export async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async (maxSteps: number) => {
    await new Promise<void>((resolve) => {
      let lastHeight = 0;
      let steps = 0;
      const step = window.innerHeight * 0.9;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        const h = document.body.scrollHeight;
        steps++;
        const atBottom = window.scrollY + window.innerHeight >= h - 2;
        if ((h === lastHeight && atBottom) || steps >= maxSteps) {
          clearInterval(timer);
          resolve();
        }
        lastHeight = h;
      }, 250);
    });
  }, MAX_SCROLL_STEPS);
  // chờ ảnh lazy kịp tải, rồi về đầu trang
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

/** Mở trang trong 1 viewport, chờ ổn định, auto-scroll. Trả về page (caller tự đóng context). */
export async function openStablePage(
  browser: Browser,
  url: string,
  vp: Viewport
): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    userAgent: USER_AGENT,
    deviceScaleFactor: 1,
  });
  // tsx/esbuild "keepNames" chèn helper __name() vào hàm có tên; helper này không tồn tại
  // trong ngữ cảnh browser khi page.evaluate chạy → shim nó về identity để tránh ReferenceError.
  await context.addInitScript(() => {
    // @ts-expect-error định nghĩa global trong browser
    window.__name = window.__name || ((fn: unknown) => fn);
  });

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // networkidle có thể không bao giờ đạt trên site nhiều tracker → bọc try/catch
  try {
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  } catch {
    /* bỏ qua: trang vẫn dùng được */
  }
  await autoScroll(page);
  return page;
}

/** Chụp full-page + above-the-fold cho mọi viewport. */
export async function captureScreenshots(
  browser: Browser,
  url: string,
  paths: CapturePaths
): Promise<void> {
  await fs.ensureDir(paths.screenshots);
  for (const vp of viewports) {
    const page = await openStablePage(browser, url, vp);
    try {
      await page.screenshot({
        path: `${paths.screenshots}/${vp.name}-full.png`,
        fullPage: true,
      });
      await page.screenshot({
        path: `${paths.screenshots}/${vp.name}-above-fold.png`,
        fullPage: false,
      });
      console.log(`  ✓ screenshot ${vp.name} (full + above-fold)`);
    } finally {
      await page.context().close();
    }
  }
}

/** Lưu HTML snapshot + metadata.json. Trả về metadata để dùng trong report. */
export async function saveSnapshot(
  page: Page,
  url: string,
  paths: CapturePaths
): Promise<PageMetadata> {
  await fs.ensureDir(paths.snapshots);

  const html = await page.content();
  await fs.writeFile(paths.pageHtml, html, "utf-8");

  const info = await page.evaluate(() => {
    const metaContent = (sel: string) =>
      document.querySelector(sel)?.getAttribute("content") ?? "";
    // font thật đã load (chỉ lấy custom font, bỏ generic) — dùng FontFaceSet
    const webFonts = Array.from(
      new Set(
        Array.from((document as any).fonts ?? [])
          .map((f: any) => (f.family ?? "").replace(/["']/g, "").trim())
          .filter((n: string) => n.length > 0)
      )
    ).slice(0, 12) as string[];
    return {
      title: document.title ?? "",
      description:
        metaContent('meta[name="description"]') ||
        metaContent('meta[property="og:description"]'),
      lang: document.documentElement.getAttribute("lang") ?? "",
      ogImage: metaContent('meta[property="og:image"]'),
      webFonts,
      bodyHeight: document.body?.scrollHeight ?? 0,
      bodyWidth: document.body?.scrollWidth ?? 0,
    };
  });

  const metadata: PageMetadata = {
    title: info.title,
    description: info.description,
    url,
    finalUrl: page.url(),
    lang: info.lang,
    ogImage: info.ogImage,
    webFonts: info.webFonts,
    bodyHeight: info.bodyHeight,
    bodyWidth: info.bodyWidth,
    capturedAt: new Date().toISOString(),
    viewports: viewports.map((v) => v.name),
  };

  await fs.writeJSON(paths.metadata, metadata, { spaces: 2 });
  console.log(`  ✓ snapshot HTML + metadata`);
  return metadata;
}
