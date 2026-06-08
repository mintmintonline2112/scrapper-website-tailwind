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

/**
 * Cố gắng đóng cookie/consent banner & modal phủ màn trước khi chụp/đo.
 * Hai bước: (1) bấm nút "Accept/Đồng ý/OK…" của các CMP phổ biến,
 * (2) gỡ phần tử overlay fixed còn sót + bỏ scroll-lock trên body.
 * Banner làm sai lệch nặng cả screenshot lẫn thống kê màu, nên đáng làm sớm.
 */
export async function dismissOverlays(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const clean = (s: string | null | undefined) =>
        (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

      // (1) bấm nút chấp nhận — đa ngôn ngữ, khớp cả text lẫn aria-label
      const ACCEPT =
        /^(accept all|accept|agree|i agree|allow all|allow|got it|ok|okay|continue|đồng ý|chấp nhận|tôi đồng ý|accepter|akzeptieren|aceptar|aceitar|同意|同意する)$/i;
      const clickables = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, [role="button"], a, input[type="button"], input[type="submit"]'
        )
      );
      for (const el of clickables) {
        const label = clean(el.textContent) || clean(el.getAttribute("aria-label")) ||
          clean((el as HTMLInputElement).value);
        if (label && ACCEPT.test(label)) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            el.click();
            break;
          }
        }
      }

      // (2) gỡ overlay còn sót: CMP có id/class quen thuộc + phần tử fixed phủ lớn
      const SELECTORS = [
        '[id*="onetrust" i]', '[class*="onetrust" i]',
        '[id*="cookiebot" i]', '[id*="cookie" i]', '[class*="cookie" i]',
        '[class*="consent" i]', '[id*="consent" i]',
        '[id*="didomi" i]', '[id*="usercentrics" i]', '[class*="cmp" i]',
        '[aria-modal="true"]', ".modal-backdrop", "#gdpr", "[data-testid*='cookie' i]",
      ];
      const kill = new Set<Element>();
      for (const sel of SELECTORS) {
        try {
          document.querySelectorAll(sel).forEach((e) => kill.add(e));
        } catch {
          /* selector không hợp lệ trên engine cũ */
        }
      }
      // phần tử fixed/sticky phủ phần lớn viewport (backdrop modal vô danh)
      document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed" && cs.position !== "sticky") return;
        const r = el.getBoundingClientRect();
        const coversMost =
          r.width >= window.innerWidth * 0.6 && r.height >= window.innerHeight * 0.6;
        const z = parseInt(cs.zIndex, 10);
        if (coversMost && (z > 1000 || cs.position === "fixed")) {
          const txt = clean(el.textContent);
          if (/cookie|consent|gdpr|privacy|subscribe|newsletter/.test(txt) || txt.length < 4)
            kill.add(el);
        }
      });
      kill.forEach((e) => e.remove());

      // bỏ scroll-lock mà modal hay đặt
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    });
    await page.waitForTimeout(250);
  } catch {
    /* không chặn pipeline nếu trang lạ */
  }
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
  await dismissOverlays(page);
  await autoScroll(page);
  return page;
}

/** Chụp full-page + above-the-fold cho một page đã mở & ổn định sẵn. */
export async function screenshotPage(
  page: Page,
  name: string,
  paths: CapturePaths
): Promise<void> {
  await fs.ensureDir(paths.screenshots);
  await page.screenshot({
    path: `${paths.screenshots}/${name}-full.png`,
    fullPage: true,
  });
  await page.screenshot({
    path: `${paths.screenshots}/${name}-above-fold.png`,
    fullPage: false,
  });
  console.log(`  ✓ screenshot ${name} (full + above-fold)`);
}

/**
 * Chụp screenshot cho các viewport KHÔNG phải desktop (mỗi cái 1 page riêng).
 * Desktop được xử lý riêng ở run.ts để tái dùng cùng page cho cả scrape → bớt 1 lần load.
 */
export async function captureNonDesktopScreenshots(
  browser: Browser,
  url: string,
  paths: CapturePaths
): Promise<void> {
  for (const vp of viewports.filter((v) => v.name !== "desktop")) {
    const page = await openStablePage(browser, url, vp);
    try {
      await screenshotPage(page, vp.name, paths);
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
