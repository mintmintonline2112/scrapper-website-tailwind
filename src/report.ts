import fs from "fs-extra";
import { PageMetadata } from "./capture.js";
import { CapturePaths } from "./config.js";
import { DesignTokens } from "./cluster-tokens.js";
import { LayoutMap } from "./scrape-dom.js";

/** Sinh rebuild-brief.md kết hợp metadata + structure + design tokens. */
export async function generateBrief(
  meta: PageMetadata,
  layout: LayoutMap,
  tokens: DesignTokens,
  paths: CapturePaths
): Promise<void> {
  const t = tokens;
  const h1 = layout.headings.find((h) => h.tag === "h1")?.text ?? "(không có h1)";
  const sectionOrder = layout.sections
    .map((s) => `${s.tag}${s.text ? ` — "${s.text.slice(0, 50)}"` : ""}`)
    .join("\n- ");

  const ctaList = layout.buttons
    .slice(0, 12)
    .map((b) => `- \`${b.text}\`${b.href ? ` → ${b.href}` : ""}`)
    .join("\n");

  const md = `# Website Rebuild Brief

> Tạo tự động bởi UI Capture & Analyzer. Computed CSS là nguồn sự thật; screenshot là tham chiếu cho mắt người.

## Page Summary
- **URL:** ${meta.url}
- **Final URL:** ${meta.finalUrl}
- **Title:** ${meta.title}
- **Description:** ${meta.description || "(trống)"}
- **H1:** ${h1}
- **Kích thước body:** ${meta.bodyWidth} × ${meta.bodyHeight}px
- **Viewports captured:** ${meta.viewports.join(", ")}
- **Captured at:** ${meta.capturedAt}

## Page Structure (theo thứ tự DOM)
- ${sectionOrder || "(không phát hiện section)"}

### Headings
${layout.headings.slice(0, 20).map((h) => `- **${h.tag}** ${h.text}`).join("\n") || "(không có)"}

### CTA / Buttons
${ctaList || "(không phát hiện CTA)"}

### Images
- Tổng: ${layout.images.length} ảnh hiển thị (xem \`layout-map.json\` để biết src/alt/kích thước).

## Design Direction (từ computed CSS)

### Color palette
| Vai trò | Hex | Tailwind gần nhất |
|---|---|---|
| Background | \`${t.palette.background}\` | \`${t.tailwindHints.background}\` |
| Text | \`${t.palette.text}\` | \`${t.tailwindHints.text}\` |
| Primary | \`${t.palette.primary}\` | \`${t.tailwindHints.primary}\` |
| Accent | \`${t.palette.accent}\` | \`${t.tailwindHints.accent}\` |
| Border | \`${t.palette.border}\` | — |

Palette đầy đủ (theo trọng số): ${t.palette.all.map((c) => `\`${c.hex}\``).join(" ")}

### Typography
- **Fonts:** ${t.fonts.map((f) => `\`${f}\``).join(", ") || "(mặc định)"}
- **Type scale (px):** ${t.typeScale.join(" / ")}
- **Font weights:** ${t.fontWeights.join(", ") || "(mặc định)"}

### Spacing & shape
- **Spacing scale (px):** ${t.spacingScale.join(" / ")}
- **Radius scale (px):** ${t.radiusScale.join(" / ")}
- **Shadows:** ${t.shadows.length ? t.shadows.map((s) => `\`${s}\``).join(" • ") : "(không/không đáng kể)"}

### Layout
- **Container max-width:** \`${t.layout.containerMaxWidth}\` (Tailwind: \`${t.tailwindHints.containerMaxWidth}\`)
- **Grid columns hay gặp:** ${t.layout.commonGridColumns.map((g) => `\`${g}\``).join(", ") || "(chủ yếu flex)"}
- **Section padding gợi ý:** \`${t.tailwindHints.sectionPadding}\`

## Component Breakdown (đề xuất)
- Header / Nav
- HeroSection
- FeatureSection
- ${layout.sections.length > 4 ? "ContentSection (×N)" : "ContentSection"}
- CTASection
- Footer

## Tailwind Rebuild Notes
- Dùng \`${t.tailwindHints.containerMaxWidth} mx-auto\` cho container.
- Section spacing: \`${t.tailwindHints.sectionPadding}\`.
- Primary button: \`bg-${t.tailwindHints.primary} text-white rounded-${radiusClass(t.radiusScale)} px-6 py-3\`.
- Body text: \`text-${t.tailwindHints.text}\`, nền \`bg-${t.tailwindHints.background}\`.

## Legal / Usage Note
Use as reference only. Rebuild with original brand assets, copy, images, and design adjustments.
Do not copy proprietary source code, logos, text, or exact design for public/commercial cloning.
`;

  await fs.writeFile(paths.rebuildBrief, md, "utf-8");
  console.log(`  ✓ rebuild-brief.md`);
}

function radiusClass(scale: number[]): string {
  const r = scale.find((x) => x > 0) ?? 8;
  if (r >= 9999) return "full";
  const map: Record<number, string> = {
    2: "sm", 4: "md", 6: "md", 8: "lg", 12: "xl", 16: "2xl", 24: "3xl",
  };
  return map[r] ?? "lg";
}
