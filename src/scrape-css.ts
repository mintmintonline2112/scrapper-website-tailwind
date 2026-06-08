import fs from "fs-extra";
import type { Page } from "playwright";
import { CapturePaths } from "./config.js";

/** Bảng tần suất: giá trị -> số lần xuất hiện (có trọng số theo diện tích element). */
export type FreqMap = Record<string, number>;

export interface RawTokens {
  /** màu chữ */
  textColors: FreqMap;
  /** màu nền (đã bỏ trong suốt) */
  backgrounds: FreqMap;
  fontFamilies: FreqMap;
  fontSizes: FreqMap; // px
  fontWeights: FreqMap;
  lineHeights: FreqMap;
  /** màu lấy riêng từ CTA/link (background nút filled + màu chữ link) — tín hiệu brand */
  accents: FreqMap;
  /** màu border thật (chỉ element có border-width > 0) */
  borders: FreqMap;
  /** padding/gap (KHÔNG gồm margin) đã tách thành px đơn lẻ */
  spacings: FreqMap; // px
  /** padding dọc của riêng section/container lớn — cho section padding hint */
  sectionPaddings: FreqMap; // px
  radii: FreqMap; // px
  shadows: FreqMap;
  /** mẫu layout từ các container lớn */
  layout: {
    selector: string;
    display: string;
    gridTemplateColumns: string;
    maxWidth: string;
    width: number;
  }[];
}

/**
 * Scrape computed style từ browser thật — đây là nguồn sự thật của tool.
 * Lấy giá trị ĐÃ resolve (getComputedStyle), nên CSS-in-JS / Tailwind JIT vẫn đọc đúng.
 */
export async function scrapeCss(
  page: Page,
  paths: CapturePaths
): Promise<RawTokens> {
  await fs.ensureDir(paths.analysis);

  const raw = await page.evaluate(() => {
    const SELECTORS = [
      "body",
      "header",
      "footer",
      "main",
      "section",
      "nav",
      "h1",
      "h2",
      "h3",
      "h4",
      "p",
      "a",
      "button",
      '[role="button"]',
      "li",
      "div",
    ];

    const bump = (map: Record<string, number>, key: string, w = 1) => {
      if (!key) return;
      map[key] = (map[key] ?? 0) + w;
    };

    // Chuẩn hoá MỌI định dạng màu (rgb/hex/lab/oklab/oklch/named...) về "rgb(r, g, b)"
    // bằng chính engine của browser → tránh tự parse từng color space.
    const _cv = document.createElement("canvas");
    _cv.width = _cv.height = 1;
    const _cx = _cv.getContext("2d", { willReadFrequently: true })!;
    // memoize: getImageData rất chậm, mà giá trị màu lặp lại rất nhiều giữa các element.
    const _colorCache = new Map<string, string>();
    const normColor = (c: string): string => {
      if (!c || c === "transparent" || c === "none") return "";
      const cached = _colorCache.get(c);
      if (cached !== undefined) return cached;
      _cx.clearRect(0, 0, 1, 1);
      _cx.fillStyle = "#000";
      _cx.fillStyle = c; // browser parse; nếu không hợp lệ giữ "#000"
      _cx.fillRect(0, 0, 1, 1);
      const d = _cx.getImageData(0, 0, 1, 1).data;
      const result = d[3] < 25 ? "" : `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
      _colorCache.set(c, result);
      return result;
    };

    const pushPx = (map: Record<string, number>, value: string, w: number) => {
      // tách "16px 24px" -> [16, 24]; bỏ 0 và giá trị quá lớn (margin auto, 100%...)
      (value.match(/-?\d+(\.\d+)?px/g) ?? []).forEach((tok) => {
        const n = Math.round(parseFloat(tok));
        if (n > 0 && n <= 200) bump(map, String(n), w);
      });
    };

    const textColors: Record<string, number> = {};
    const backgrounds: Record<string, number> = {};
    const fontFamilies: Record<string, number> = {};
    const fontSizes: Record<string, number> = {};
    const fontWeights: Record<string, number> = {};
    const lineHeights: Record<string, number> = {};
    const accents: Record<string, number> = {};
    const borders: Record<string, number> = {};
    const spacings: Record<string, number> = {};
    const sectionPaddings: Record<string, number> = {};
    const radii: Record<string, number> = {};
    const shadows: Record<string, number> = {};
    const layout: RawLayout[] = [];

    interface RawLayout {
      selector: string;
      display: string;
      gridTemplateColumns: string;
      maxWidth: string;
      width: number;
    }

    const MAX_ELEMENTS = 5000; // chặn chi phí getComputedStyle trên SPA cực lớn
    const all = document.querySelectorAll(SELECTORS.join(","));
    const elements = all.length > MAX_ELEMENTS ? Array.from(all).slice(0, MAX_ELEMENTS) : all;
    elements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return; // bỏ element ẩn
      // trọng số ~ căn bậc hai diện tích, có trần → vùng lớn ảnh hưởng nhiều hơn
      // nhưng một body khổng lồ không nuốt hết (log nén quá mạnh, count-weight thì bỏ qua diện tích).
      const area = rect.width * rect.height;
      const w = Math.max(1, Math.min(40, Math.round(Math.sqrt(area) / 30)));

      const s = getComputedStyle(el);
      const tag = el.tagName;

      bump(textColors, normColor(s.color), w);
      bump(backgrounds, normColor(s.backgroundColor), w);
      bump(fontFamilies, s.fontFamily.split(",")[0].replace(/["']/g, "").trim(), w);
      pushPx(fontSizes, s.fontSize, w);
      bump(fontWeights, s.fontWeight, w);
      bump(lineHeights, s.lineHeight, w);

      // spacing = padding + gap (KHÔNG margin: margin là offset layout, nhiễu)
      pushPx(spacings, s.paddingTop, w);
      pushPx(spacings, s.paddingLeft, w);
      pushPx(spacings, s.gap, w);

      pushPx(radii, s.borderTopLeftRadius, w);

      if (s.boxShadow && s.boxShadow !== "none") bump(shadows, s.boxShadow, w);

      // border color thật (chỉ khi có viền nhìn thấy)
      if (parseFloat(s.borderTopWidth) > 0) {
        const bc = normColor(s.borderTopColor);
        if (bc) bump(borders, bc, w);
      }

      // padding dọc của section/container lớn → section padding hint riêng
      const isSectionish =
        tag === "SECTION" ||
        ((tag === "DIV" || tag === "MAIN" || tag === "HEADER" || tag === "FOOTER") &&
          rect.width >= 600 &&
          rect.height >= 200);
      if (isSectionish) {
        pushPx(sectionPaddings, s.paddingTop, 1);
        pushPx(sectionPaddings, s.paddingBottom, 1);
      }

      // ---- brand signal: màu trên CTA/link ----
      if (el.matches('button, [role="button"]') || tag === "A") {
        const bg = normColor(s.backgroundColor);
        if (bg) bump(accents, bg, w * 6); // bg nút filled = tín hiệu brand mạnh nhất
        const fg = normColor(s.color);
        if (fg) bump(accents, fg, w * 2);
        if (parseFloat(s.borderTopWidth) > 0) {
          const bc = normColor(s.borderTopColor);
          if (bc) bump(accents, bc, w);
        }
      }

      // layout: chỉ lấy container đủ rộng (>= 300px) và có flex/grid
      if (
        rect.width >= 300 &&
        (s.display.includes("grid") || s.display.includes("flex"))
      ) {
        layout.push({
          selector: tag.toLowerCase(),
          display: s.display,
          gridTemplateColumns: s.gridTemplateColumns,
          maxWidth: s.maxWidth,
          width: Math.round(rect.width),
        });
      }
    });

    return {
      textColors,
      backgrounds,
      fontFamilies,
      fontSizes,
      fontWeights,
      lineHeights,
      accents,
      borders,
      spacings,
      sectionPaddings,
      radii,
      shadows,
      layout: layout.slice(0, 120),
    };
  });

  await fs.writeJSON(paths.tokensRaw, raw, { spaces: 2 });
  console.log(
    `  ✓ CSS scrape: ${Object.keys(raw.textColors).length} màu chữ, ` +
      `${Object.keys(raw.backgrounds).length} màu nền, ` +
      `${Object.keys(raw.spacings).length} mức spacing thô`
  );
  return raw as RawTokens;
}

/** Chỉ 4 nhóm màu (text/bg/accent/border) — để đo lại palette ở chế độ dark. */
export interface ColorScheme {
  textColors: FreqMap;
  backgrounds: FreqMap;
  accents: FreqMap;
  borders: FreqMap;
}

/**
 * Đo lại MÀU sau khi emulateMedia({colorScheme:"dark"}) — KHÔNG reload trang nên rất nhanh.
 * Trang có dark mode (qua prefers-color-scheme) sẽ trả palette khác hẳn light.
 */
export async function scrapeColorScheme(page: Page): Promise<ColorScheme> {
  return page.evaluate(() => {
    const SELECTORS = ["body", "header", "footer", "main", "section", "nav", "h1", "h2", "h3", "p", "a", "button", '[role="button"]', "li", "div"];
    const bump = (m: Record<string, number>, k: string, w = 1) => { if (k) m[k] = (m[k] ?? 0) + w; };
    const _cv = document.createElement("canvas");
    _cv.width = _cv.height = 1;
    const _cx = _cv.getContext("2d", { willReadFrequently: true })!;
    const cache = new Map<string, string>();
    const normColor = (c: string): string => {
      if (!c || c === "transparent" || c === "none") return "";
      const hit = cache.get(c);
      if (hit !== undefined) return hit;
      _cx.clearRect(0, 0, 1, 1);
      _cx.fillStyle = "#000";
      _cx.fillStyle = c;
      _cx.fillRect(0, 0, 1, 1);
      const d = _cx.getImageData(0, 0, 1, 1).data;
      const out = d[3] < 25 ? "" : `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
      cache.set(c, out);
      return out;
    };
    const textColors: Record<string, number> = {};
    const backgrounds: Record<string, number> = {};
    const accents: Record<string, number> = {};
    const borders: Record<string, number> = {};
    const all = Array.from(document.querySelectorAll(SELECTORS.join(","))).slice(0, 5000);
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const w = Math.max(1, Math.min(40, Math.round(Math.sqrt(rect.width * rect.height) / 30)));
      const s = getComputedStyle(el);
      bump(textColors, normColor(s.color), w);
      bump(backgrounds, normColor(s.backgroundColor), w);
      if (parseFloat(s.borderTopWidth) > 0) bump(borders, normColor(s.borderTopColor), w);
      if (el.matches('button, [role="button"]') || el.tagName === "A") {
        const bg = normColor(s.backgroundColor);
        if (bg) bump(accents, bg, w * 6);
        const fg = normColor(s.color);
        if (fg) bump(accents, fg, w * 2);
      }
    }
    return { textColors, backgrounds, accents, borders };
  });
}
