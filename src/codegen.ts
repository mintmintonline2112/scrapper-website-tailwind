import fs from "fs-extra";
import path from "node:path";
import { PageMetadata } from "./capture.js";
import { CapturePaths } from "./config.js";
import { DesignTokens } from "./cluster-tokens.js";
import { ComponentNode, ComponentTree } from "./generate.js";

/**
 * Phase 6 – sinh starter Next.js + Tailwind THẬT (file .tsx compile được) từ tokens +
 * component tree. Màu brand nhúng qua CSS variable để hiển thị đúng ngay cả khi chưa
 * cấu hình Tailwind theme. Nội dung dùng placeholder lấy từ heading/CTA đã capture.
 */
export async function generateCode(
  meta: PageMetadata,
  tokens: DesignTokens,
  tree: ComponentTree,
  paths: CapturePaths
): Promise<void> {
  const dir = paths.rebuildDir;
  const componentsDir = path.join(dir, "components");
  const appDir = path.join(dir, "app");
  await fs.emptyDir(dir); // dọn output cũ để không còn file component thừa
  await fs.ensureDir(componentsDir);
  await fs.ensureDir(appDir);

  // mỗi component → 1 file .tsx
  for (const c of tree.components) {
    const code = renderComponent(c, tokens, meta);
    await fs.writeFile(path.join(componentsDir, `${c.name}.tsx`), code, "utf-8");
  }

  await fs.writeFile(path.join(appDir, "page.tsx"), renderPage(tree, meta), "utf-8");
  await fs.writeFile(path.join(appDir, "globals.css"), renderGlobals(tokens), "utf-8");
  await fs.writeFile(
    path.join(dir, "tailwind.tokens.cjs"),
    renderTailwindTokens(tokens),
    "utf-8"
  );
  await fs.writeFile(path.join(dir, "README.md"), renderReadme(tree, tokens), "utf-8");

  console.log(
    `  ✓ Phase 6: rebuild/ (${tree.components.length} components + page.tsx + globals.css + tailwind.tokens.cjs)`
  );
}

// ---------- helpers ----------

const cssVars = (t: DesignTokens) => `:root {
  --color-bg: ${t.palette.background};
  --color-text: ${t.palette.text};
  --color-primary: ${t.palette.primary};
  --color-accent: ${t.palette.accent};
  --color-border: ${t.palette.border};
}`;

function radiusClass(t: DesignTokens): string {
  const r = t.radiusScale.find((x) => x > 0) ?? 8;
  if (r >= 9999) return "rounded-full";
  if (r <= 3) return "rounded-sm";
  if (r <= 6) return "rounded-md";
  if (r <= 10) return "rounded-lg";
  if (r <= 16) return "rounded-xl";
  return "rounded-2xl";
}

const container = (t: DesignTokens) => `${t.tailwindHints.containerMaxWidth} mx-auto px-6`;
const sectionPad = (t: DesignTokens) => t.tailwindHints.sectionPadding || "py-16 px-6";

function esc(s: string): string {
  return s.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;").replace(/`/g, "'");
}

function renderComponent(
  c: ComponentNode,
  t: DesignTokens,
  meta: PageMetadata
): string {
  const r = radiusClass(t);
  const headline =
    c.contains.find((x) => x.startsWith("headline"))?.replace(/^headline:\s*"?|"$/g, "") ||
    c.contains.find((x) => x.startsWith("heading"))?.replace(/^heading:\s*"?|"$/g, "") ||
    "";
  const ctaText =
    (c.contains.find((x) => /CTA/i.test(x))?.match(/"([^"]+)"/)?.[1]) || "Get started";

  switch (c.role) {
    case "navigation":
      return wrap(
        c.name,
        `<header className="border-b border-[var(--color-border)]">
      <nav className="${container(t)} flex h-16 items-center justify-between">
        <span className="text-lg font-bold">${esc(meta.title?.split(/[|\-–]/)[0]?.trim() || "Brand")}</span>
        <ul className="hidden gap-8 text-sm md:flex">
          {["Features", "Pricing", "Docs", "Company"].map((l) => (
            <li key={l}><a href="#" className="text-[var(--color-text)]/70 hover:text-[var(--color-text)]">{l}</a></li>
          ))}
        </ul>
        <a href="#" className="${r} bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white">${esc(ctaText)}</a>
      </nav>
    </header>`
      );

    case "hero":
      return wrap(
        c.name,
        `<section className="${sectionPad(t)}">
      <div className="${container(t)} text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          ${esc(headline || "A clear, original headline goes here")}
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-[var(--color-text)]/70">
          Placeholder subheading — replace with your own value proposition.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <a href="#" className="${r} bg-[var(--color-primary)] px-6 py-3 font-medium text-white">${esc(ctaText)}</a>
          <a href="#" className="${r} border border-[var(--color-border)] px-6 py-3 font-medium">Learn more</a>
        </div>
      </div>
    </section>`
      );

    case "features": {
      const n = Math.min(Math.max(c.cardCount ?? 3, 3), 6);
      return wrap(
        c.name,
        `<section className="${sectionPad(t)}">
      <div className="${container(t)}">
        ${headline ? `<h2 className="mb-10 text-center text-3xl font-bold">${esc(headline)}</h2>` : ""}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-${Math.min(n, 3)}">
          {Array.from({ length: ${n} }).map((_, i) => (
            <div key={i} className="${r} border border-[var(--color-border)] p-6">
              <div className="${r} mb-4 h-10 w-10 bg-[var(--color-primary)]/10" />
              <h3 className="text-lg font-semibold">Feature {i + 1}</h3>
              <p className="mt-2 text-sm text-[var(--color-text)]/70">
                Short placeholder description of this feature or benefit.
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>`
      );
    }

    case "conversion":
      return wrap(
        c.name,
        `<section className="${sectionPad(t)}">
      <div className="${container(t)} ${r} bg-[var(--color-primary)] px-8 py-16 text-center text-white">
        <h2 className="text-3xl font-bold">${esc(headline || "Ready to get started?")}</h2>
        <p className="mx-auto mt-4 max-w-lg text-white/80">Placeholder supporting copy for the call to action.</p>
        <a href="#" className="${r} mt-8 inline-block bg-white px-6 py-3 font-medium text-[var(--color-primary)]">${esc(ctaText)}</a>
      </div>
    </section>`
      );

    case "footer":
      return wrap(
        c.name,
        `<footer className="border-t border-[var(--color-border)] ${sectionPad(t)}">
      <div className="${container(t)} grid grid-cols-2 gap-8 md:grid-cols-4">
        {["Product", "Company", "Resources", "Legal"].map((col) => (
          <div key={col}>
            <h4 className="mb-3 text-sm font-semibold">{col}</h4>
            <ul className="space-y-2 text-sm text-[var(--color-text)]/60">
              {["Link one", "Link two", "Link three"].map((l) => (
                <li key={l}><a href="#" className="hover:text-[var(--color-text)]">{l}</a></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="${container(t)} mt-10 text-sm text-[var(--color-text)]/50">© ${"{new Date().getFullYear()}"} ${esc(meta.title?.split(/[|\-–]/)[0]?.trim() || "Brand")}. Rebuilt for reference.</p>
    </footer>`
      );

    default:
      return wrap(
        c.name,
        `<section className="${sectionPad(t)}">
      <div className="${container(t)}">
        ${headline ? `<h2 className="mb-6 text-3xl font-bold">${esc(headline)}</h2>` : ""}
        <p className="max-w-2xl text-[var(--color-text)]/70">Placeholder content section.</p>
      </div>
    </section>`
      );
  }
}

function wrap(name: string, body: string): string {
  return `export default function ${name}() {
  return (
    ${body}
  );
}
`;
}

function renderPage(tree: ComponentTree, meta: PageMetadata): string {
  const imports = tree.components
    .map((c) => `import ${c.name} from "@/components/${c.name}";`)
    .join("\n");
  const usage = tree.components.map((c) => `      <${c.name} />`).join("\n");
  return `${imports}

export const metadata = {
  title: ${JSON.stringify(meta.title || "Rebuilt Landing Page")},
  description: ${JSON.stringify(meta.description || "Original rebuild for reference.")},
};

export default function Page() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
${usage}
    </main>
  );
}
`;
}

function renderGlobals(t: DesignTokens): string {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

${cssVars(t)}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: ${t.fonts[0] ? `"${t.fonts[0]}", ` : ""}system-ui, sans-serif;
}
`;
}

function renderTailwindTokens(t: DesignTokens): string {
  const spacing = t.spacingScale.reduce<Record<string, string>>((m, px) => {
    m[`s${px}`] = `${px}px`;
    return m;
  }, {});
  const theme = {
    colors: {
      bg: t.palette.background,
      text: t.palette.text,
      primary: t.palette.primary,
      accent: t.palette.accent,
      border: t.palette.border,
    },
    fontSize: t.typeScale.reduce<Record<string, string>>((m, px) => {
      m[`t${px}`] = `${px}px`;
      return m;
    }, {}),
    spacing,
    borderRadius: t.radiusScale.reduce<Record<string, string>>((m, px) => {
      m[`r${px}`] = px >= 9999 ? "9999px" : `${px}px`;
      return m;
    }, {}),
  };
  return `// Trộn vào tailwind.config theme.extend của bạn.
module.exports = ${JSON.stringify(theme, null, 2)};
`;
}

function renderReadme(tree: ComponentTree, t: DesignTokens): string {
  return `# Rebuild starter (generated)

Starter Next.js (App Router) + Tailwind sinh tự động từ design tokens. **Reference only** —
thay nội dung/ảnh/branding bằng tài sản gốc của bạn.

## Dùng
1. Tạo app Next.js + Tailwind (\`npx create-next-app@latest --tailwind\`).
2. Copy \`app/page.tsx\`, \`app/globals.css\`, và \`components/*.tsx\` vào app.
3. Trộn \`tailwind.tokens.cjs\` vào \`tailwind.config\` (theme.extend).

## Tokens chính
- primary \`${t.palette.primary}\` · accent \`${t.palette.accent}\` · bg \`${t.palette.background}\` · text \`${t.palette.text}\`
- container \`${t.tailwindHints.containerMaxWidth}\` · section padding \`${t.tailwindHints.sectionPadding}\`

## Components
${tree.components.map((c) => `- \`${c.name}.tsx\` (${c.role})`).join("\n")}
`;
}
