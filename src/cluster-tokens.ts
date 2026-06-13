import fs from "fs-extra";
import { CapturePaths } from "./config.js";
import { ColorScheme, FreqMap, RawTokens } from "./scrape-css.js";
import {
  RGB,
  colorDist,
  luminance,
  parseColor,
  saturation,
  toHex,
} from "./color-utils.js";

export interface SimplePalette {
  background: string;
  text: string;
  primary: string;
  accent: string;
  border: string;
}

export interface DesignTokens {
  palette: SimplePalette & {
    all: { hex: string; weight: number }[];
  };
  /** Palette ở chế độ dark (chỉ có khi site thật sự hỗ trợ prefers-color-scheme:dark). */
  darkPalette?: SimplePalette;
  spacingScale: number[];
  typeScale: number[];
  radiusScale: number[];
  shadows: string[];
  fonts: string[];
  fontWeights: number[];
  layout: {
    containerMaxWidth: string;
    commonGridColumns: string[];
  };
  tailwindHints: {
    primary: string;
    accent: string;
    background: string;
    text: string;
    containerMaxWidth: string;
    sectionPadding: string;
  };
}

interface ColorCluster {
  center: RGB;
  weight: number;
}

/** Gom cụm màu theo redmean, trả về danh sách cluster đã sắp theo trọng số giảm dần. */
function clusterColors(freq: FreqMap, threshold = 32): ColorCluster[] {
  const entries = Object.entries(freq)
    .map(([c, w]) => ({ rgb: parseColor(c), w }))
    .filter((e): e is { rgb: RGB; w: number } => e.rgb !== null)
    .sort((a, b) => b.w - a.w);

  const clusters: ColorCluster[] = [];
  for (const { rgb, w } of entries) {
    let merged = false;
    for (const cl of clusters) {
      if (colorDist(cl.center, rgb) < threshold) {
        // cập nhật tâm theo trung bình có trọng số
        const tw = cl.weight + w;
        cl.center = {
          r: (cl.center.r * cl.weight + rgb.r * w) / tw,
          g: (cl.center.g * cl.weight + rgb.g * w) / tw,
          b: (cl.center.b * cl.weight + rgb.b * w) / tw,
        };
        cl.weight = tw;
        merged = true;
        break;
      }
    }
    if (!merged) clusters.push({ center: { ...rgb }, weight: w });
  }
  return clusters.sort((a, b) => b.weight - a.weight);
}

// ---------- numeric scale helpers ----------

/** Gom px về scale chuẩn gần nhất, giữ top N theo tần suất. */
export function clusterScale(freq: FreqMap, candidates: number[], keep: number): number[] {
  const snapped: Record<number, number> = {};
  for (const [val, w] of Object.entries(freq)) {
    const n = parseFloat(val);
    let nearest = candidates[0];
    let best = Infinity;
    for (const c of candidates) {
      const d = Math.abs(c - n);
      if (d < best) {
        best = d;
        nearest = c;
      }
    }
    snapped[nearest] = (snapped[nearest] ?? 0) + w;
  }
  return Object.entries(snapped)
    .sort((a, b) => b[1] - a[1])
    .slice(0, keep)
    .map(([v]) => Number(v))
    .sort((a, b) => a - b);
}

function topKeys(freq: FreqMap, keep: number): string[] {
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, keep)
    .map(([k]) => k);
}

// ---------- Tailwind nearest-match ----------

const TAILWIND_COLORS: Record<string, string> = {
  "#ffffff": "white", "#000000": "black",
  "#f9fafb": "gray-50", "#f3f4f6": "gray-100", "#e5e7eb": "gray-200",
  "#d1d5db": "gray-300", "#9ca3af": "gray-400", "#6b7280": "gray-500",
  "#4b5563": "gray-600", "#374151": "gray-700", "#1f2937": "gray-800",
  "#111827": "gray-900",
  "#ef4444": "red-500", "#f97316": "orange-500", "#f59e0b": "amber-500",
  "#eab308": "yellow-500", "#22c55e": "green-500", "#10b981": "emerald-500",
  "#14b8a6": "teal-500", "#06b6d4": "cyan-500", "#3b82f6": "blue-500",
  "#6366f1": "indigo-500", "#8b5cf6": "violet-500", "#a855f7": "purple-500",
  "#ec4899": "pink-500", "#2563eb": "blue-600", "#1d4ed8": "blue-700",
  // dark blues / navy / slate — để màu brand tối (vd #1c3d71) không bị map nhầm sang gray
  "#1e40af": "blue-800", "#1e3a8a": "blue-900", "#172554": "blue-950",
  "#0c4a6e": "sky-900", "#075985": "sky-800",
  "#334155": "slate-700", "#1e293b": "slate-800", "#0f172a": "slate-900",
  "#3730a3": "indigo-800", "#312e81": "indigo-900",
};

export function nearestTailwind(hex: string): string {
  const target = parseColor(
    `rgb(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)})`
  );
  if (!target) return hex;
  let best = hex;
  let bestD = Infinity;
  for (const [h, name] of Object.entries(TAILWIND_COLORS)) {
    const rgb = parseColor(
      `rgb(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)})`
    )!;
    const d = colorDist(target, rgb);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

const SPACING_CANDIDATES = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96];
const TYPE_CANDIDATES = [12, 14, 16, 18, 20, 24, 30, 36, 48, 60];
const RADIUS_CANDIDATES = [2, 4, 6, 8, 12, 16, 24, 9999];

function nearestSpacingClass(px: number): string {
  const map: Record<number, string> = {
    4: "1", 8: "2", 12: "3", 16: "4", 20: "5", 24: "6",
    32: "8", 40: "10", 48: "12", 56: "14", 64: "16",
    80: "20", 96: "24", 112: "28", 128: "32",
  };
  // snap về key gần nhất
  const keys = Object.keys(map).map(Number);
  let nearest = keys[0];
  let best = Infinity;
  for (const k of keys) {
    const d = Math.abs(k - px);
    if (d < best) { best = d; nearest = k; }
  }
  return map[nearest];
}

const SECTION_PAD_CANDIDATES = [16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128];

/** Padding dọc section điển hình: snap về candidate, lấy mức ≥24 có trọng số lớn nhất. */
function dominantSectionPad(freq: FreqMap): number {
  const snapped: Record<number, number> = {};
  for (const [val, w] of Object.entries(freq)) {
    const n = parseFloat(val);
    let nearest = SECTION_PAD_CANDIDATES[0];
    let best = Infinity;
    for (const c of SECTION_PAD_CANDIDATES) {
      const d = Math.abs(c - n);
      if (d < best) { best = d; nearest = c; }
    }
    snapped[nearest] = (snapped[nearest] ?? 0) + w;
  }
  const ranked = Object.entries(snapped)
    .map(([v, w]) => ({ v: Number(v), w }))
    .filter((e) => e.v >= 24) // padding section thật thường ≥ 24px
    .sort((a, b) => b.w - a.w);
  return ranked[0]?.v ?? 48;
}

// ---------- palette picking (dùng chung cho light & dark) ----------

interface PaletteRGB {
  background: RGB;
  text: RGB;
  primary: RGB;
  accent: RGB;
  border: RGB;
  all: ColorCluster[];
}

/** Chọn bg/text/primary/accent/border từ 4 nhóm màu. Dùng cho cả light lẫn dark scheme. */
function pickPalette(
  textColors: FreqMap,
  backgrounds: FreqMap,
  accents: FreqMap,
  borders: FreqMap
): PaletteRGB {
  const textClusters = clusterColors(textColors).slice(0, 6);
  const bgClusters = clusterColors(backgrounds).slice(0, 6);
  const allClusters = clusterColors(mergeFreq(textColors, backgrounds)).slice(0, 12);

  // bg = cụm nền có trọng số lớn nhất (không ép sáng — để dark scheme ra nền tối đúng)
  const background = bgClusters[0]?.center ?? { r: 255, g: 255, b: 255 };
  const bgLum = luminance(background);
  // text = cụm chữ tương phản tốt với nền (sáng↔tối ngược chiều bg)
  const text =
    textClusters.find((c) =>
      bgLum > 0.5 ? luminance(c.center) < 0.5 : luminance(c.center) > 0.5
    )?.center ??
    textClusters[0]?.center ??
    { r: 17, g: 24, b: 39 };

  const isBrandy = (c: RGB) =>
    saturation(c) > 0.2 && luminance(c) > 0.1 && luminance(c) < 0.92;
  const brandScore = (cl: ColorCluster) => cl.weight * Math.pow(saturation(cl.center), 1.3);

  const accentClusters = clusterColors(accents)
    .filter((c) => isBrandy(c.center))
    .sort((a, b) => brandScore(b) - brandScore(a));
  const generalSaturated = allClusters
    .filter((c) => isBrandy(c.center))
    .sort((a, b) => brandScore(b) - brandScore(a));
  const brandRanked = accentClusters.length ? accentClusters : generalSaturated;

  const primary = brandRanked[0]?.center ?? { r: 59, g: 130, b: 246 };
  const accent =
    brandRanked.slice(1).find((c) => colorDist(c.center, primary) > 40)?.center ??
    generalSaturated.find((c) => colorDist(c.center, primary) > 40)?.center ??
    primary;

  const borderClusters = clusterColors(borders);
  const border =
    borderClusters[0]?.center ??
    bgClusters
      .map((c) => c.center)
      .filter((c) => Math.abs(luminance(c) - bgLum) > 0.05 && Math.abs(luminance(c) - bgLum) < 0.25)
      .sort((a, b) => Math.abs(luminance(a) - bgLum) - Math.abs(luminance(b) - bgLum))[0] ??
    { r: 229, g: 231, b: 235 };

  return { background, text, primary, accent, border, all: allClusters };
}

const toSimple = (p: PaletteRGB): SimplePalette => ({
  background: toHex(p.background),
  text: toHex(p.text),
  primary: toHex(p.primary),
  accent: toHex(p.accent),
  border: toHex(p.border),
});

// ---------- main ----------

export async function clusterTokens(
  raw: RawTokens,
  paths: CapturePaths,
  darkColors?: ColorScheme
): Promise<DesignTokens> {
  // ---- colors (light) ----
  const pal = pickPalette(raw.textColors, raw.backgrounds, raw.accents, raw.borders);
  const { background, text, primary, accent, border, all: allClusters } = pal;

  // ---- colors (dark) — chỉ giữ nếu site thật sự đổi nền khi prefers-color-scheme:dark ----
  let darkPalette: SimplePalette | undefined;
  if (darkColors) {
    const dpal = pickPalette(darkColors.textColors, darkColors.backgrounds, darkColors.accents, darkColors.borders);
    // khác biệt thật: nền dark phải tối hơn rõ rệt nền light
    if (luminance(background) - luminance(dpal.background) > 0.25) {
      darkPalette = toSimple(dpal);
    }
  }

  // ---- scales ----
  const spacingScale = clusterScale(raw.spacings, SPACING_CANDIDATES, 6);
  const typeScale = clusterScale(raw.fontSizes, TYPE_CANDIDATES, 7);
  const radiusScale = clusterScale(raw.radii, RADIUS_CANDIDATES, 4);
  const fonts = topKeys(raw.fontFamilies, 3);
  const fontWeights = topKeys(raw.fontWeights, 4)
    .map((w) => parseInt(w, 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);
  const shadows = topKeys(raw.shadows, 3);

  // ---- layout ----
  // containerMaxWidth: gom ứng viên từ maxWidth + gridTemplateColumns 1-cột (= bề rộng nội dung),
  // chỉ lấy trong [600,1400] để LOẠI full-bleed shell (≈viewport 1440) và container con quá hẹp.
  // Chọn px phổ biến nhất (tie-break rộng hơn).
  const widthFreq: Record<number, number> = {};
  const addW = (px: number) => {
    if (px >= 600 && px <= 1400) widthFreq[px] = (widthFreq[px] ?? 0) + 1;
  };
  for (const l of raw.layout) {
    if (l.maxWidth && /\dpx/.test(l.maxWidth)) addW(parseInt(l.maxWidth, 10));
    const gc = (l.gridTemplateColumns ?? "").trim();
    if (/^\d+(\.\d+)?px$/.test(gc)) addW(parseInt(gc, 10)); // grid 1 cột = bề rộng nội dung
  }
  const bestW = Object.keys(widthFreq)
    .map(Number)
    .sort((a, b) => widthFreq[b] - widthFreq[a] || b - a)[0];
  const containerMaxWidth = bestW ? `${bestW}px` : "1280px";

  const gridFreq: FreqMap = {};
  for (const l of raw.layout) {
    if (l.gridTemplateColumns && l.gridTemplateColumns !== "none")
      bumpStr(gridFreq, l.gridTemplateColumns);
  }
  const commonGridColumns = topKeys(gridFreq, 3);

  // ---- section padding hint: đo từ padding dọc THẬT của section, không từ scale chung ----
  const sectionPad = dominantSectionPad(raw.sectionPaddings);
  const midSpacing = spacingScale.find((s) => s >= 16 && s <= 32) ?? 24;

  const tokens: DesignTokens = {
    palette: {
      background: toHex(background),
      text: toHex(text),
      primary: toHex(primary),
      accent: toHex(accent),
      border: toHex(border),
      all: allClusters.map((c) => ({
        hex: toHex(c.center),
        weight: Math.round(c.weight),
      })),
    },
    darkPalette,
    spacingScale,
    typeScale,
    radiusScale,
    shadows,
    fonts,
    fontWeights,
    layout: { containerMaxWidth, commonGridColumns },
    tailwindHints: {
      primary: nearestTailwind(toHex(primary)),
      accent: nearestTailwind(toHex(accent)),
      background: nearestTailwind(toHex(background)),
      text: nearestTailwind(toHex(text)),
      containerMaxWidth: tailwindMaxWidth(containerMaxWidth),
      sectionPadding: `py-${nearestSpacingClass(sectionPad)} px-${nearestSpacingClass(midSpacing)}`,
    },
  };

  await fs.writeJSON(paths.tokens, tokens, { spaces: 2 });
  console.log(
    `  ✓ cluster: palette[bg ${tokens.palette.background}, text ${tokens.palette.text}, ` +
      `primary ${tokens.palette.primary}], spacing[${spacingScale.join(",")}], type[${typeScale.join(",")}]` +
      (darkPalette ? `, dark bg ${darkPalette.background}` : "")
  );
  return tokens;
}

// ---------- small utils ----------

function mergeFreq(a: FreqMap, b: FreqMap): FreqMap {
  const out: FreqMap = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

function bumpStr(map: FreqMap, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function tailwindMaxWidth(px: string): string {
  const n = parseInt(px, 10);
  if (isNaN(n)) return "max-w-7xl";
  const map: [number, string][] = [
    [640, "max-w-screen-sm"], [768, "max-w-screen-md"],
    [1024, "max-w-screen-lg"], [1280, "max-w-7xl"], [1536, "max-w-screen-2xl"],
  ];
  let best = "max-w-7xl";
  let bestD = Infinity;
  for (const [w, cls] of map) {
    const d = Math.abs(w - n);
    if (d < bestD) {
      bestD = d;
      best = cls;
    }
  }
  return best;
}
