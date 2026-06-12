import fs from "fs-extra";
import { PageMetadata } from "./capture.js";
import { CapturePaths } from "./config.js";
import { DesignTokens } from "./cluster-tokens.js";
import {
  CardInfo,
  ImageInfo,
  LayoutMap,
  SectionButton,
  SectionInfo,
  SectionLayout,
  SectionRole,
} from "./scrape-dom.js";

/** Nội dung thật của một section, mang nguyên xuống codegen để rebuild faithful. */
export interface SectionContent {
  heading: string;
  subtext: string;
  buttons: SectionButton[];
  cards: CardInfo[];
  images: ImageInfo[];
  layout: SectionLayout;
}

export interface ComponentNode {
  name: string;
  /** = SectionRole, codegen switch trên giá trị này */
  role: SectionRole;
  /** gợi ý nội dung (cho ai-prompt + dashboard) */
  contains: string[];
  cardCount?: number;
  source?: { tag: string; index: number };
  /** nội dung thật để codegen inline (không có ở fallback) */
  data?: SectionContent;
}

export interface ComponentTree {
  page: string;
  components: ComponentNode[];
}

const NAME_BY_ROLE: Record<SectionRole, string> = {
  header: "Header",
  hero: "HeroSection",
  features: "FeatureSection",
  pricing: "PricingSection",
  testimonial: "TestimonialSection",
  logos: "LogoCloud",
  faq: "FAQSection",
  stats: "StatsSection",
  cta: "CTASection",
  content: "ContentSection",
  footer: "Footer",
};

/**
 * Phase 4 – suy ra component tree từ layout-map (đã giàu nội dung) + tokens,
 * rồi sinh ai-prompt.md. Mỗi section giữ nguyên content thật để codegen dùng.
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

  const used: Record<string, number> = {};
  const uniqueName = (base: string) => {
    used[base] = (used[base] ?? 0) + 1;
    return used[base] === 1 ? base : `${base}${used[base]}`;
  };

  let headerDone = false;
  let footerDone = false;
  let contentCount = 0;
  const MAX_CONTENT = 5;

  for (const s of layout.sections) {
    // chỉ giữ MỘT Header và MỘT Footer; landmark trùng hạ xuống content
    let role: SectionRole = s.role;
    if (role === "header" && headerDone) role = "content";
    if (role === "footer" && footerDone) role = "content";
    if (role === "content") {
      // bỏ content section RỖNG (không heading, card, subtext, ảnh) → tránh "Placeholder section"
      const empty =
        !s.heading && !s.subtext && s.cards.length === 0 && s.images.length === 0;
      if (empty) continue;
      if (contentCount >= MAX_CONTENT) continue;
      contentCount++;
    }
    if (role === "header") headerDone = true;
    if (role === "footer") footerDone = true;

    const name = role === "header" ? "Header" : role === "footer" ? "Footer" : uniqueName(NAME_BY_ROLE[role]);

    const data: SectionContent = {
      heading: s.heading || (role === "hero" && h1 ? h1 : ""),
      subtext: s.subtext,
      buttons: s.buttons.length
        ? s.buttons
        : primaryCta
        ? [{ text: primaryCta.text, href: primaryCta.href, emphasis: "filled" }]
        : [],
      cards: s.cards,
      images: s.images,
      layout: s.layout,
    };

    components.push({
      name,
      role,
      contains: summarize(role, data, s),
      cardCount: s.cardCount >= 3 ? s.cardCount : undefined,
      source: { tag: s.tag, index: s.index },
      data,
    });
  }

  if (components.length === 0) {
    components.push(
      { name: "Header", role: "header", contains: ["logo", "nav"] },
      { name: "HeroSection", role: "hero", contains: ["headline", "CTA"] },
      { name: "Footer", role: "footer", contains: ["copyright"] }
    );
  }

  // Header luôn đầu, Footer luôn cuối — bất kể vị trí 'top' đo được (header sticky/giữa trang).
  const orderRank = (r: SectionRole) => (r === "header" ? 0 : r === "footer" ? 2 : 1);
  const ordered = components
    .map((c, i) => ({ c, i }))
    .sort((a, b) => orderRank(a.c.role) - orderRank(b.c.role) || a.i - b.i)
    .map((x) => x.c);

  const tree: ComponentTree = { page: meta.title || meta.url, components: ordered };
  await fs.writeJSON(paths.components, tree, { spaces: 2 });

  await writeAiPrompt(meta, tokens, tree, paths);

  console.log(`  ✓ Phase 4: components.json (${components.length} components) + ai-prompt.md`);
  return tree;
}

/** Tóm tắt section thành các dòng người đọc (cho ai-prompt + dashboard). */
function summarize(role: SectionRole, d: SectionContent, s: SectionInfo): string[] {
  const out: string[] = [];
  if (d.heading) out.push(`heading: "${d.heading.slice(0, 80)}"`);
  if (d.subtext) out.push(`subtext: "${d.subtext.slice(0, 60)}…"`);
  const cta = d.buttons[0];
  if (cta) out.push(`CTA: "${cta.text}"`);
  if (s.cardCount >= 3) {
    out.push(`${s.cardCount} ${role === "pricing" ? "plans" : role === "testimonial" ? "quotes" : role === "stats" ? "stats" : "cards"} · ${d.layout.columns} cols`);
  }
  if (d.images.length) out.push(`${d.images.length} images`);
  if (role === "header") out.push("logo", "nav links");
  if (role === "footer") out.push("nav columns", "copyright");
  return out;
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

## Components to build (with measured layout)
${componentSpec}

## Requirements
- Use semantic HTML and reusable React components.
- Tailwind CSS only; map the tokens above to the closest Tailwind utilities.
- Match the measured column counts/alignment per section above.
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
