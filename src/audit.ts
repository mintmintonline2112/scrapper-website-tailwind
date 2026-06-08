import fs from "fs-extra";
import type { Page } from "playwright";
import { CapturePaths } from "./config.js";

export interface ContrastIssue {
  sample: string;
  fg: string;
  bg: string;
  ratio: number;
  required: number;
  fontSize: number;
}

export interface AccessibilityReport {
  contrast: {
    checked: number;
    failed: number;
    issues: ContrastIssue[]; // mẫu, đã cắt
  };
  images: { total: number; missingAlt: number; samples: string[] };
  headings: {
    sequence: string[]; // ["h1","h2","h3",...]
    h1Count: number;
    skips: string[]; // ví dụ "h2 → h4"
  };
  controls: { unnamedButtons: number; unnamedLinks: number };
  score: number; // 0..100 thô
}

/**
 * Phase 7 – audit accessibility ngay trên page (đã có computed style nên kiểm tra
 * contrast WCAG thật). Báo cáo: contrast fail, ảnh thiếu alt, thứ tự heading, control vô danh.
 */
export async function auditAccessibility(
  page: Page,
  paths: CapturePaths
): Promise<AccessibilityReport> {
  const report = (await page.evaluate(() => {
    const clean = (s: string | null | undefined) =>
      (s ?? "").replace(/\s+/g, " ").trim();

    // ---- WCAG contrast ----
    const toRgb = (c: string): [number, number, number] | null => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(",").map((x) => parseFloat(x.trim()));
      if (p[3] !== undefined && p[3] < 0.1) return null;
      return [p[0], p[1], p[2]];
    };
    const srgb = (c: number) => {
      const x = c / 255;
      return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    const relLum = ([r, g, b]: [number, number, number]) =>
      0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
    const ratio = (a: [number, number, number], b: [number, number, number]) => {
      const hi = Math.max(relLum(a), relLum(b)) + 0.05;
      const lo = Math.min(relLum(a), relLum(b)) + 0.05;
      return hi / lo;
    };

    // nền hiệu dụng: leo cha tới khi gặp background không trong suốt
    const effectiveBg = (el: Element): [number, number, number] => {
      let cur: Element | null = el;
      while (cur) {
        const rgb = toRgb(getComputedStyle(cur).backgroundColor);
        if (rgb) return rgb;
        cur = cur.parentElement;
      }
      return [255, 255, 255];
    };

    const hasOwnText = (el: Element) =>
      Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && clean(n.textContent).length > 0
      );

    const textEls = Array.from(
      document.querySelectorAll("p, h1, h2, h3, h4, h5, h6, a, button, li, span, label, strong, em")
    );
    let checked = 0;
    let failed = 0;
    const issues: {
      sample: string;
      fg: string;
      bg: string;
      ratio: number;
      required: number;
      fontSize: number;
    }[] = [];

    for (const el of textEls) {
      if (!hasOwnText(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.opacity === "0") continue;
      const fg = toRgb(cs.color);
      if (!fg) continue;
      const bg = effectiveBg(el);
      const size = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      const required = large ? 3 : 4.5;
      const cr = ratio(fg, bg);
      checked++;
      if (cr < required) {
        failed++;
        if (issues.length < 12) {
          issues.push({
            sample: clean(el.textContent).slice(0, 60),
            fg: `rgb(${fg.join(", ")})`,
            bg: `rgb(${bg.join(", ")})`,
            ratio: Math.round(cr * 100) / 100,
            required,
            fontSize: Math.round(size),
          });
        }
      }
    }

    // ---- images alt ----
    const imgs = Array.from(document.querySelectorAll("img"));
    const visImgs = imgs.filter((i) => {
      const r = i.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && i.getAttribute("role") !== "presentation";
    });
    const missing = visImgs.filter((i) => !clean(i.getAttribute("alt")));

    // ---- heading order ----
    const hs = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
    const sequence = hs.map((h) => h.tagName.toLowerCase());
    const skips: string[] = [];
    for (let i = 1; i < hs.length; i++) {
      const prev = parseInt(hs[i - 1].tagName[1], 10);
      const cur = parseInt(hs[i].tagName[1], 10);
      if (cur - prev > 1) skips.push(`h${prev} → h${cur}`);
    }
    const h1Count = sequence.filter((t) => t === "h1").length;

    // ---- controls không có tên ----
    const named = (el: Element) =>
      clean(el.textContent) ||
      clean(el.getAttribute("aria-label")) ||
      clean(el.getAttribute("title")) ||
      (el.querySelector("img")?.getAttribute("alt") ?? "");
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    const links = Array.from(document.querySelectorAll("a[href]"));
    const unnamedButtons = buttons.filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && !named(b);
    }).length;
    const unnamedLinks = links.filter((a) => {
      const r = a.getBoundingClientRect();
      return r.width > 0 && !named(a);
    }).length;

    return {
      contrast: { checked, failed, issues },
      images: {
        total: visImgs.length,
        missingAlt: missing.length,
        samples: missing.slice(0, 8).map((i) => i.currentSrc || i.src || "(no src)"),
      },
      headings: { sequence, h1Count, skips },
      controls: { unnamedButtons, unnamedLinks },
    };
  })) as Omit<AccessibilityReport, "score">;

  // điểm thô: trừ theo mức độ vi phạm
  const contrastPenalty =
    report.contrast.checked > 0
      ? (report.contrast.failed / report.contrast.checked) * 50
      : 0;
  const altPenalty =
    report.images.total > 0 ? (report.images.missingAlt / report.images.total) * 25 : 0;
  const headingPenalty =
    (report.headings.h1Count !== 1 ? 8 : 0) + Math.min(report.headings.skips.length * 3, 9);
  const controlPenalty = Math.min(
    (report.controls.unnamedButtons + report.controls.unnamedLinks) * 2,
    16
  );
  const score = Math.max(
    0,
    Math.round(100 - contrastPenalty - altPenalty - headingPenalty - controlPenalty)
  );

  const full: AccessibilityReport = { ...report, score };
  await fs.writeJSON(paths.accessibility, full, { spaces: 2 });
  await fs.writeFile(paths.accessibilityReport, renderReport(full), "utf-8");
  console.log(
    `  ✓ a11y: score ${score}/100 — contrast ${report.contrast.failed}/${report.contrast.checked} fail, ` +
      `${report.images.missingAlt}/${report.images.total} ảnh thiếu alt, h1×${report.headings.h1Count}`
  );
  return full;
}

function renderReport(r: AccessibilityReport): string {
  const issueRows = r.contrast.issues
    .map(
      (i) =>
        `| \`${i.sample || "(text)"}\` | ${i.ratio} | ${i.required} | \`${i.fg}\` / \`${i.bg}\` | ${i.fontSize}px |`
    )
    .join("\n");
  return `# Accessibility audit

> Tự động bởi UI Capture & Analyzer. Kiểm tra trên computed style thật (contrast WCAG).

**Score thô: ${r.score}/100**

## Contrast (WCAG AA)
- Đã kiểm: **${r.contrast.checked}** phần tử text · Fail: **${r.contrast.failed}**
${
  r.contrast.issues.length
    ? `\n| Text | Ratio | Cần | Màu chữ / nền | Cỡ |
|---|---|---|---|---|
${issueRows}\n`
    : "- Không phát hiện lỗi contrast đáng kể trong mẫu.\n"
}
## Ảnh
- Tổng ảnh hiển thị: **${r.images.total}** · Thiếu \`alt\`: **${r.images.missingAlt}**
${r.images.samples.length ? r.images.samples.map((s) => `  - ${s}`).join("\n") : ""}

## Heading order
- Số \`h1\`: **${r.headings.h1Count}** ${r.headings.h1Count === 1 ? "✓" : "⚠ (nên có đúng 1)"}
- Trình tự: ${r.headings.sequence.join(" → ") || "(không có heading)"}
- Nhảy cấp: ${r.headings.skips.length ? r.headings.skips.join(", ") : "không"}

## Control vô danh (không có nhãn truy cập)
- Button: **${r.controls.unnamedButtons}** · Link: **${r.controls.unnamedLinks}**

---
*Đây là audit của TRANG GỐC — dùng để biết cần sửa gì khi rebuild, không phải audit của code sinh ra.*
`;
}
