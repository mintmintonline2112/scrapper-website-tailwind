/**
 * Toán màu dùng chung cho cluster-tokens (gom cụm) và codegen (chọn màu chữ tương phản).
 * Tách riêng để pure + test được, không phụ thuộc fs/browser.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Parse "rgb(r, g, b)" / "rgba(r, g, b, a)". Trả null nếu gần như trong suốt hoặc không hợp lệ. */
export function parseColor(c: string): RGB | null {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
  const [r, g, b, a] = parts;
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  if (a !== undefined && a < 0.1) return null; // gần như trong suốt
  return { r, g, b };
}

/** Parse "#rrggbb" (hoặc "#rgb") sang RGB. */
export function hexToRgb(hex: string): RGB | null {
  let h = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: RGB): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Khoảng cách màu "redmean" — xấp xỉ cảm nhận mắt người, đủ tốt để gom cụm. */
export function colorDist(a: RGB, b: RGB): number {
  const rm = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(
    (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db
  );
}

/** Độ sáng cảm nhận thô (0 đen .. 1 trắng) — dùng để phân loại bg/text. */
export function luminance({ r, g, b }: RGB): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function saturation({ r, g, b }: RGB): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

// ---------- WCAG contrast (để chọn màu chữ đọc được) ----------

function srgb(channel: number): number {
  const x = channel / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** Độ chói tương đối theo WCAG. */
export function relLuminance(c: RGB): number {
  return 0.2126 * srgb(c.r) + 0.7152 * srgb(c.g) + 0.0722 * srgb(c.b);
}

/** Tỉ lệ tương phản WCAG giữa hai màu (1 = giống hệt, 21 = đen/trắng). */
export function contrastRatio(a: RGB, b: RGB): number {
  const hi = Math.max(relLuminance(a), relLuminance(b)) + 0.05;
  const lo = Math.min(relLuminance(a), relLuminance(b)) + 0.05;
  return hi / lo;
}

const WHITE: RGB = { r: 255, g: 255, b: 255 };
const INK: RGB = { r: 17, g: 17, b: 17 };

/**
 * Chọn màu chữ (#ffffff hoặc #111111) có tương phản WCAG tốt hơn trên nền cho trước.
 * Nhận hex ("#rrggbb") hoặc "rgb(...)" hoặc RGB.
 */
export function readableOn(bg: RGB | string): string {
  const rgb =
    typeof bg === "string" ? hexToRgb(bg) ?? parseColor(bg) : bg;
  if (!rgb) return "#ffffff";
  return contrastRatio(rgb, WHITE) >= contrastRatio(rgb, INK) ? "#ffffff" : "#111111";
}
