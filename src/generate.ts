import fs from "fs-extra";
import { PageMetadata } from "./capture.js";
import { CapturePaths } from "./config.js";
import { DesignTokens } from "./cluster-tokens.js";
import { LayoutMap } from "./scrape-dom.js";

export interface ComponentNode {
  name: string;
  role: string;
  /** gợi ý nội dung/element con để rebuild */
  contains: string[];
  /** số card nếu là section dạng grid (cho code generator) */
  cardCount?: number;
  source?: { tag: string; index: number };
}

export interface ComponentTree {
  page: string;
  components: ComponentNode[];
}

/**
 * Phase 4 – suy ra component tree từ layout-map + tokens, rồi sinh ai-prompt.md.
 * Heuristic đơn giản: map các section/header/footer thật sang component có tên chuẩn,
 * đoán Hero/CTA/Feature dựa trên vị trí + heading + số lượng CTA.
 */
export async function generateComponents(
  meta: PageMetadata,
  layout: LayoutMap,
  tokens: DesignTokens,
  paths: CapturePaths
): Promise<ComponentTree> {
  const components: ComponentNode[] = [];
  const h1 = layout.headings.find((h) => h.tag === "h1")?.text;
  const primaryCta = layout.buttons.find((b) => b.role === "button") ?? layout.buttons[0];

  // Đếm để đặt tên duy nhất khi cùng role lặp lại (FeatureSection, FeatureSection2…)
  const used: Record<string, number> = {};
  const uniqueName = (base: string) => {
    used[base] = (used[base] ?? 0) + 1;
    return used[base] === 1 ? base : `${base}${used[base]}`;
  };

  let headerDone = false;
  let footerDone = false;
  let contentCount = 0;
  const MAX_CONTENT = 5; // tránh sinh quá nhiều ContentSection cho trang phức tạp

  for (const s of layout.sections) {
    const contains: string[] = [];
    let name: string;
    let role: string;

    // chỉ giữ MỘT Header và MỘT Footer; landmark trùng (sub-nav…) hạ xuống content
    let effectiveRole: string = s.role;
    if (effectiveRole === "header" && headerDone) effectiveRole = "content";
    if (effectiveRole === "footer" && footerDone) effectiveRole = "content";

    // bỏ bớt content section dư thừa
    if (effectiveRole === "content") {
      if (contentCount >= MAX_CONTENT) continue;
      contentCount++;
    }

    switch (effectiveRole) {
      case "header":
        name = "Header";
        role = "navigation";
        headerDone = true;
        contains.push("logo", "nav links");
        if (primaryCta) contains.push(`CTA: "${primaryCta.text}"`);
        break;
      case "hero":
        name = uniqueName("HeroSection");
        role = "hero";
        if (h1) contains.push(`headline: "${h1.slice(0, 80)}"`);
        if (primaryCta) contains.push(`primary CTA: "${primaryCta.text}"`);
        break;
      case "features":
        name = uniqueName("FeatureSection");
        role = "features";
        if (s.heading) contains.push(`heading: "${s.heading}"`);
        contains.push(`grid of ${s.cardCount} cards`);
        break;
      case "cta":
        name = uniqueName("CTASection");
        role = "conversion";
        if (s.heading) contains.push(`heading: "${s.heading}"`);
        if (primaryCta) contains.push(`CTA: "${primaryCta.text}"`);
        break;
      case "footer":
        name = "Footer";
        role = "footer";
        footerDone = true;
        contains.push("nav columns", "copyright", "social links");
        break;
      default:
        name = uniqueName("ContentSection");
        role = "content";
        if (s.heading) contains.push(`heading: "${s.heading}"`);
    }

    components.push({
      name,
      role,
      contains,
      cardCount: s.cardCount >= 3 ? s.cardCount : undefined,
      source: { tag: s.tag, index: s.index },
    });
  }

  // luôn đảm bảo tối thiểu có khung cơ bản
  if (components.length === 0) {
    components.push(
      { name: "Header", role: "navigation", contains: ["logo", "nav"] },
      { name: "HeroSection", role: "hero", contains: ["headline", "CTA"] },
      { name: "Footer", role: "footer", contains: ["copyright"] }
    );
  }

  const tree: ComponentTree = { page: meta.title || meta.url, components };
  await fs.writeJSON(paths.components, tree, { spaces: 2 });

  await writeAiPrompt(meta, tokens, tree, paths);

  console.log(`  ✓ Phase 4: components.json (${components.length} components) + ai-prompt.md`);
  return tree;
}

async function writeAiPrompt(
  meta: PageMetadata,
  t: DesignTokens,
  tree: ComponentTree,
  paths: CapturePaths
): Promise<void> {
  const componentList = tree.components.map((c) => c.name).join(", ");
  const componentSpec = tree.components
    .map(
      (c) =>
        `- **${c.name}** (${c.role})${c.contains.length ? `: ${c.contains.join("; ")}` : ""}`
    )
    .join("\n");

  const prompt = `You are a senior frontend engineer.

Rebuild a new ORIGINAL landing page using Next.js (App Router) and Tailwind CSS,
using the design tokens below as the source of truth and the attached screenshots
as visual/layout reference only. Do NOT copy original brand assets, text, logos,
or proprietary design exactly. Use placeholder content and images.

## Design Tokens (extracted from computed CSS)

Colors:
- background: ${t.palette.background} (tailwind: ${t.tailwindHints.background})
- text:       ${t.palette.text} (tailwind: ${t.tailwindHints.text})
- primary:    ${t.palette.primary} (tailwind: ${t.tailwindHints.primary})
- accent:     ${t.palette.accent} (tailwind: ${t.tailwindHints.accent})
- border:     ${t.palette.border}
- full palette: ${t.palette.all.map((c) => c.hex).join(", ")}

Typography:
- fonts: ${t.fonts.join(", ") || "system-ui"}
- type scale (px): ${t.typeScale.join(", ")}
- font weights: ${t.fontWeights.join(", ") || "400, 700"}

Spacing & shape:
- spacing scale (px): ${t.spacingScale.join(", ")}
- radius scale (px): ${t.radiusScale.join(", ")}
- container: ${t.layout.containerMaxWidth} → use ${t.tailwindHints.containerMaxWidth} mx-auto
- section padding: ${t.tailwindHints.sectionPadding}

## Components to build
${componentSpec}

## Requirements
- Use semantic HTML and reusable React components.
- Tailwind CSS only; map the tokens above to the closest Tailwind utilities.
- Responsive for desktop (1440), tablet (768), mobile (390).
- Clean, maintainable, accessible (proper headings, alt text, aria where needed).
- Use placeholder copy and images (e.g. /placeholder.svg or picsum).

## Output files
- app/page.tsx (composes the components below)
${tree.components.map((c) => `- components/${c.name}.tsx`).join("\n")}

## Page meta (for <head>)
- title: ${meta.title || "Rebuilt Landing Page"}
- description: ${meta.description || "Original rebuild for reference."}

Build: ${componentList}.
`;

  await fs.writeFile(paths.aiPrompt, prompt, "utf-8");
}
