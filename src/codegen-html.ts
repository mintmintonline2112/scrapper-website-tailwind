import fs from "fs-extra";
import path from "node:path";
import { PageMetadata } from "./capture.js";
import { CapturePaths } from "./config.js";
import { DesignTokens } from "./cluster-tokens.js";
import { ComponentNode, ComponentTree, SectionContent } from "./generate.js";
import { SectionButton } from "./scrape-dom.js";
import { readableOn } from "./color-utils.js";
import { ImageMap, LocalImage, detectGoogleFont } from "./codegen.js";

/**
 * Phase 6b – sinh bản VANILLA HTML + CSS + JS từ cùng tokens + nội dung + layout đo được.
 * Tự chạy: mở rebuild-html/index.html bằng trình duyệt là xem được, KHÔNG cần build/Node.
 * Dùng chung ảnh đã tải của bản Tailwind (copy sang assets/).
 */
export async function generateHtml(
  meta: PageMetadata,
  tokens: DesignTokens,
  tree: ComponentTree,
  paths: CapturePaths,
  imgMap: ImageMap
): Promise<void> {
  const dir = paths.rebuildHtmlDir;
  await fs.emptyDir(dir);

  // copy ảnh từ bản Tailwind (rebuild/public/images) sang rebuild-html/assets
  const srcImages = path.join(paths.rebuildDir, "public", "images");
  if (imgMap.size && (await fs.pathExists(srcImages))) {
    await fs.copy(srcImages, path.join(dir, "assets"));
  }
  // map src gốc -> đường dẫn local trong bản HTML ("assets/img-0.webp")
  const htmlImg: ImageMap = new Map();
  for (const [src, img] of imgMap) {
    htmlImg.set(src, { ...img, file: `assets/${img.file.split("/").pop()}` });
  }

  const body = tree.components.map((c) => renderSection(c, tokens, meta, htmlImg)).join("\n\n");

  await fs.writeFile(path.join(dir, "index.html"), renderIndex(tree, tokens, meta, body), "utf-8");
  await fs.writeFile(path.join(dir, "styles.css"), renderCss(tokens), "utf-8");
  await fs.writeFile(path.join(dir, "script.js"), renderJs(!!tokens.darkPalette), "utf-8");
  await fs.writeFile(path.join(dir, "README.md"), renderReadme(), "utf-8");

  console.log(`  ✓ Phase 6b: rebuild-html/ (index.html + styles.css + script.js${htmlImg.size ? " + assets" : ""})`);
}

// ---------- helpers ----------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function brand(meta: PageMetadata): string {
  return esc(meta.title?.split(/[|\-–—·]/)[0]?.trim() || "Brand");
}

const clampCol = (n: number) => Math.max(1, Math.min(Math.round(n), 4));

/** inline custom props cho grid responsive đo được. */
function gridStyle(d: SectionContent, fallback: number): string {
  const c = clampCol(d.layout.columns || fallback);
  const t = clampCol(d.layout.columnsTablet ?? Math.min(2, c));
  const m = clampCol(d.layout.columnsMobile ?? 1);
  return `--cols:${c};--cols-md:${t};--cols-sm:${m};--gap:${Math.max(8, d.layout.gap || 24)}px`;
}

function padStyle(d: SectionContent): string {
  return d.layout.paddingY >= 16 ? ` style="padding-block:${d.layout.paddingY}px"` : "";
}

function pickImage(d: SectionContent, imgMap: ImageMap): LocalImage | null {
  const found = d.images
    .map((im) => imgMap.get(im.src))
    .filter((x): x is LocalImage => !!x)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  return found[0] ?? null;
}

function imgTag(img: LocalImage, cls: string): string {
  return `<img src="${img.file}" alt="${esc(img.alt || "")}" width="${img.width}" height="${img.height}" loading="lazy" class="${cls}">`;
}

function buttons(btns: SectionButton[]): string {
  const list = btns.length ? btns : [{ text: "Get started", emphasis: "filled" as const }];
  return list
    .slice(0, 2)
    .map((b) => {
      const cls = b.emphasis === "filled" ? "btn btn--primary" : b.emphasis === "outline" ? "btn btn--outline" : "btn btn--link";
      return `<a href="#" class="${cls}">${esc(b.text)}</a>`;
    })
    .join("\n          ");
}

// ---------- per-role section renderers ----------

function renderSection(c: ComponentNode, t: DesignTokens, meta: PageMetadata, imgMap: ImageMap): string {
  const d: SectionContent = c.data ?? {
    heading: "", subtext: "", buttons: [], cards: [], images: [],
    layout: { display: "block", columns: 1, gap: 24, maxWidth: "none", align: "left", paddingY: 64 },
  };
  const heroImg = pickImage(d, imgMap);
  const alignClass = d.layout.align === "center" ? " center" : d.layout.align === "right" ? " right" : "";

  switch (c.role) {
    case "header": {
      const navLinks = d.buttons.filter((b) => b.emphasis !== "filled").slice(0, 4).map((b) => b.text);
      const links = (navLinks.length ? navLinks : ["Features", "Pricing", "Docs", "Company"])
        .map((l) => `<li><a href="#">${esc(l)}</a></li>`)
        .join("");
      const cta = d.buttons.find((b) => b.emphasis === "filled")?.text ?? "Get started";
      const themeBtn = t.darkPalette
        ? `<button class="theme-toggle" data-theme-toggle aria-label="Đổi sáng/tối">◐</button>`
        : "";
      return `<header class="site-header">
  <div class="container nav">
    <span class="brand">${brand(meta)}</span>
    <button class="nav-toggle" aria-label="Mở menu">☰</button>
    <ul class="nav-links">${links}</ul>
    <div class="nav-actions">${themeBtn}<a href="#" class="btn btn--primary">${esc(cta)}</a></div>
  </div>
</header>`;
    }

    case "hero":
      return `<section class="section hero${alignClass}"${padStyle(d)}>
  <div class="container">
    <h1>${esc(d.heading || "A clear, original headline goes here")}</h1>
    <p class="lead muted">${esc(d.subtext || "Placeholder subheading — replace with your own value proposition.")}</p>
    <div class="actions">
          ${buttons(d.buttons)}
    </div>
    ${heroImg ? imgTag(heroImg, "hero-img") : ""}
  </div>
</section>`;

    case "features": {
      const cards = (d.cards.length ? d.cards : fallback(3)).map((c2) => ({
        heading: esc(c2.heading || "Feature"),
        text: esc(c2.text || "Short placeholder description of this feature or benefit."),
      }));
      return `<section class="section"${padStyle(d)}>
  <div class="container">
    ${d.heading ? `<h2 class="center mb">${esc(d.heading)}</h2>` : ""}
    <div class="grid" style="${gridStyle(d, cards.length)}">
      ${cards.map((c2) => `<div class="card"><div class="icon"></div><h3>${c2.heading}</h3><p class="muted">${c2.text}</p></div>`).join("\n      ")}
    </div>
  </div>
</section>`;
    }

    case "pricing": {
      const plans = (d.cards.length ? d.cards : fallback(3)).slice(0, 4);
      return `<section class="section"${padStyle(d)}>
  <div class="container">
    <h2 class="center mb">${esc(d.heading || "Pricing")}</h2>
    <div class="grid" style="--cols:${clampCol(plans.length)};--cols-md:2;--cols-sm:1;--gap:24px">
      ${plans
        .map(
          (p, i) =>
            `<div class="card${i === 1 ? " card--featured" : ""}"><h3>${esc(p.heading || `Plan ${i + 1}`)}</h3><p class="muted">${esc(p.text || "What this plan includes.")}</p><p class="price">$—<span class="muted">/mo</span></p><a href="#" class="btn btn--primary full">Choose</a></div>`
        )
        .join("\n      ")}
    </div>
  </div>
</section>`;
    }

    case "testimonial": {
      const quotes = (d.cards.length ? d.cards : fallback(3)).slice(0, 6);
      return `<section class="section"${padStyle(d)}>
  <div class="container">
    ${d.heading ? `<h2 class="center mb">${esc(d.heading)}</h2>` : ""}
    <div class="grid" style="${gridStyle(d, Math.min(quotes.length, 3))}">
      ${quotes
        .map(
          (q, i) =>
            `<figure class="card"><blockquote>“${esc(q.text || "This product changed how our team works.")}”</blockquote><figcaption><span class="avatar"></span>${esc(q.heading || `Customer ${i + 1}`)}</figcaption></figure>`
        )
        .join("\n      ")}
    </div>
  </div>
</section>`;
    }

    case "logos": {
      const n = Math.min(Math.max(c.cardCount ?? d.images.length ?? 5, 4), 8);
      return `<section class="section"${padStyle(d)}>
  <div class="container center">
    ${d.heading ? `<p class="eyebrow muted">${esc(d.heading)}</p>` : ""}
    <div class="logos">${Array.from({ length: n }, () => `<span class="logo"></span>`).join("")}</div>
  </div>
</section>`;
    }

    case "stats": {
      const stats = (d.cards.length ? d.cards : fallback(3)).slice(0, 4);
      return `<section class="section"${padStyle(d)}>
  <div class="container">
    ${d.heading ? `<h2 class="center mb">${esc(d.heading)}</h2>` : ""}
    <div class="grid center" style="--cols:${clampCol(stats.length)};--cols-md:2;--cols-sm:1;--gap:32px">
      ${stats
        .map(
          (s, i) =>
            `<div><div class="stat">${esc(s.heading || `${(i + 1) * 25}%`)}</div><div class="muted">${esc(s.text || "Key metric")}</div></div>`
        )
        .join("\n      ")}
    </div>
  </div>
</section>`;
    }

    case "faq": {
      const faqs = (d.cards.length ? d.cards : fallback(4)).slice(0, 8);
      return `<section class="section"${padStyle(d)}>
  <div class="container narrow">
    <h2 class="center mb">${esc(d.heading || "FAQ")}</h2>
    <div class="faq">
      ${faqs
        .map(
          (f, i) =>
            `<details><summary>${esc(f.heading || `Question ${i + 1}?`)}</summary><p class="muted">${esc(f.text || "Placeholder answer to this frequently asked question.")}</p></details>`
        )
        .join("\n      ")}
    </div>
  </div>
</section>`;
    }

    case "cta":
      return `<section class="section"${padStyle(d)}>
  <div class="container">
    <div class="cta-box">
      <h2>${esc(d.heading || "Ready to get started?")}</h2>
      <p>${esc(d.subtext || "Placeholder supporting copy for the call to action.")}</p>
      <a href="#" class="btn cta-btn">${esc(d.buttons[0]?.text || "Get started")}</a>
    </div>
  </div>
</section>`;

    case "footer":
      return `<footer class="site-footer section">
  <div class="container footer-grid">
    ${["Product", "Company", "Resources", "Legal"]
      .map(
        (col) =>
          `<div><h4>${col}</h4><ul><li><a href="#">Link one</a></li><li><a href="#">Link two</a></li><li><a href="#">Link three</a></li></ul></div>`
      )
      .join("\n    ")}
  </div>
  <p class="container copyright muted">© <span id="year"></span> ${brand(meta)}. Rebuilt for reference.</p>
</footer>`;

    default:
      if (heroImg)
        return `<section class="section"${padStyle(d)}>
  <div class="container split">
    <div>${d.heading ? `<h2>${esc(d.heading)}</h2>` : ""}<p class="muted">${esc(d.subtext || "Placeholder content section.")}</p></div>
    ${imgTag(heroImg, "split-img")}
  </div>
</section>`;
      return `<section class="section${alignClass}"${padStyle(d)}>
  <div class="container">
    ${d.heading ? `<h2 class="mb">${esc(d.heading)}</h2>` : ""}
    <p class="muted">${esc(d.subtext || "Placeholder content section.")}</p>
  </div>
</section>`;
  }
}

function fallback(n: number): SectionContent["cards"] {
  return Array.from({ length: n }, () => ({ heading: "", text: "", hasIcon: false, hasImage: false }));
}

// ---------- document shell ----------

function renderIndex(tree: ComponentTree, t: DesignTokens, meta: PageMetadata, body: string): string {
  const gf = detectGoogleFont(t, meta);
  const fontLink = gf
    ? `\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n  <link href="${gf.url}" rel="stylesheet">`
    : "";
  const lang = (meta.lang || "en").split("-")[0] || "en";
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(meta.title || "Rebuilt page")}</title>
  <meta name="description" content="${esc(meta.description || "Original rebuild for reference.")}">${fontLink}
  <link rel="stylesheet" href="styles.css">
</head>
<body>
${body}
  <script src="script.js"></script>
</body>
</html>
`;
}

function renderCss(t: DesignTokens): string {
  const radius = (() => {
    const r = t.radiusScale.find((x) => x > 0) ?? 8;
    return r >= 9999 ? "9999px" : `${Math.min(r, 24)}px`;
  })();
  const container = parseInt(t.layout.containerMaxWidth, 10) || 1280;
  const font = t.fonts[0] ? `"${t.fonts[0]}", ` : "";
  const dark = t.darkPalette
    ? `\n[data-theme="dark"] {
  --color-bg: ${t.darkPalette.background};
  --color-text: ${t.darkPalette.text};
  --color-primary: ${t.darkPalette.primary};
  --color-accent: ${t.darkPalette.accent};
  --color-border: ${t.darkPalette.border};
  --color-on-primary: ${readableOn(t.darkPalette.primary)};
}\n`
    : "";

  return `/* Sinh tự động từ design tokens — bản vanilla, không cần build. */
*, *::before, *::after { box-sizing: border-box; }
:root {
  --color-bg: ${t.palette.background};
  --color-text: ${t.palette.text};
  --color-primary: ${t.palette.primary};
  --color-accent: ${t.palette.accent};
  --color-border: ${t.palette.border};
  --color-on-primary: ${readableOn(t.palette.primary)};
  --radius: ${radius};
  --container: ${container}px;
  --font: ${font}system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
${dark}
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--color-bg); color: var(--color-text); font-family: var(--font); line-height: 1.6; -webkit-font-smoothing: antialiased; }
img { max-width: 100%; height: auto; display: block; }
a { color: inherit; }
h1, h2, h3, h4 { line-height: 1.15; margin: 0; }
h1 { font-size: clamp(2.25rem, 4vw, 3.75rem); font-weight: 800; letter-spacing: -0.02em; }
h2 { font-size: clamp(1.75rem, 3vw, 2.25rem); font-weight: 700; }
.container { max-width: var(--container); margin: 0 auto; padding: 0 1.5rem; }
.container.narrow { max-width: 768px; }
.section { padding-block: 4rem; }
.center { text-align: center; }
.right { text-align: right; }
.muted { opacity: .7; }
.mb { margin-bottom: 2.5rem; }

/* buttons */
.btn { display: inline-block; padding: .75rem 1.5rem; border-radius: var(--radius); font-weight: 600; text-decoration: none; cursor: pointer; border: 1px solid transparent; transition: opacity .15s, background .15s; }
.btn:hover { opacity: .9; }
.btn--primary { background: var(--color-primary); color: var(--color-on-primary); }
.btn--outline { border-color: var(--color-border); background: transparent; }
.btn--link { color: var(--color-primary); background: none; padding-inline: 0; }
.btn.full { display: block; text-align: center; margin-top: 1.5rem; }

/* header / nav */
.site-header { border-bottom: 1px solid var(--color-border); position: sticky; top: 0; background: var(--color-bg); z-index: 50; }
.nav { display: flex; align-items: center; justify-content: space-between; height: 4rem; gap: 1rem; }
.brand { font-weight: 700; font-size: 1.125rem; }
.nav-links { display: flex; gap: 2rem; list-style: none; margin: 0; padding: 0; }
.nav-links a { text-decoration: none; opacity: .75; }
.nav-links a:hover { opacity: 1; }
.nav-actions { display: flex; align-items: center; gap: .75rem; }
.theme-toggle, .nav-toggle { background: none; border: 1px solid var(--color-border); border-radius: var(--radius); padding: .35rem .6rem; cursor: pointer; color: inherit; font-size: 1rem; }
.nav-toggle { display: none; }

/* hero */
.hero { text-align: center; }
.hero.center { text-align: center; }
.lead { font-size: 1.25rem; max-width: 42rem; margin: 1.5rem auto; }
.actions { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; margin-top: 2rem; }
.hero:not(.center) .actions { justify-content: flex-start; }
.hero-img { margin: 3rem auto 0; max-width: 56rem; width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius); }

/* grid + cards */
.grid { display: grid; gap: var(--gap, 1.5rem); grid-template-columns: repeat(var(--cols-sm, 1), minmax(0, 1fr)); }
@media (min-width: 640px) { .grid { grid-template-columns: repeat(var(--cols-md, 2), minmax(0, 1fr)); } }
@media (min-width: 1024px) { .grid { grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr)); } }
.card { border: 1px solid var(--color-border); border-radius: var(--radius); padding: 1.5rem; }
.card--featured { border-color: var(--color-primary); box-shadow: 0 10px 30px -12px rgba(0,0,0,.25); }
.card h3 { font-size: 1.125rem; }
.card .icon { width: 2.5rem; height: 2.5rem; border-radius: var(--radius); background: color-mix(in srgb, var(--color-primary) 12%, transparent); margin-bottom: 1rem; }
.price { font-size: 2rem; font-weight: 800; margin: 1rem 0 0; }
blockquote { margin: 0; font-size: .95rem; }
figcaption { display: flex; align-items: center; gap: .75rem; margin-top: 1rem; font-weight: 600; font-size: .9rem; }
.avatar { width: 2rem; height: 2rem; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 25%, transparent); }

/* logos / stats / split */
.eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: .8rem; margin-bottom: 2rem; }
.logos { display: flex; flex-wrap: wrap; gap: 1.5rem 3rem; align-items: center; justify-content: center; }
.logo { width: 7rem; height: 2rem; border-radius: 4px; background: color-mix(in srgb, var(--color-text) 10%, transparent); }
.stat { font-size: 2.5rem; font-weight: 800; color: var(--color-primary); }
.split { display: grid; gap: 3rem; align-items: center; }
@media (min-width: 768px) { .split { grid-template-columns: 1fr 1fr; } }
.split-img { border: 1px solid var(--color-border); border-radius: var(--radius); }

/* faq */
.faq details { border-bottom: 1px solid var(--color-border); padding: 1rem 0; }
.faq summary { cursor: pointer; font-weight: 600; list-style: none; }
.faq summary::-webkit-details-marker { display: none; }

/* cta */
.cta-box { background: var(--color-primary); color: var(--color-on-primary); border-radius: var(--radius); padding: 4rem 2rem; text-align: center; }
.cta-box p { opacity: .85; max-width: 32rem; margin: 1rem auto 0; }
.cta-btn { background: var(--color-bg); color: var(--color-primary); margin-top: 2rem; }

/* footer */
.site-footer { border-top: 1px solid var(--color-border); }
.footer-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2rem; }
@media (min-width: 768px) { .footer-grid { grid-template-columns: repeat(4, 1fr); } }
.footer-grid h4 { font-size: .9rem; margin-bottom: .75rem; }
.footer-grid ul { list-style: none; margin: 0; padding: 0; }
.footer-grid li { margin-bottom: .5rem; }
.footer-grid a { text-decoration: none; opacity: .6; font-size: .9rem; }
.footer-grid a:hover { opacity: 1; }
.copyright { margin-top: 2.5rem; font-size: .85rem; }

/* mobile nav */
@media (max-width: 767px) {
  .nav-toggle { display: block; }
  .nav-links { display: none; position: absolute; left: 0; right: 0; top: 4rem; flex-direction: column; gap: 0; background: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: .5rem 1.5rem; }
  .nav-links.open { display: flex; }
  .nav-links li { padding: .6rem 0; }
}
`;
}

function renderJs(hasDark: boolean): string {
  return `// Bản vanilla — tương tác tối thiểu, không phụ thuộc thư viện.
(function () {
  // năm hiện tại ở footer
  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  // menu mobile
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) toggle.addEventListener("click", function () { links.classList.toggle("open"); });
${
  hasDark
    ? `
  // chuyển sáng/tối (nhớ lựa chọn qua localStorage; mặc định theo hệ điều hành)
  var root = document.documentElement;
  var saved = localStorage.getItem("theme");
  if (saved) root.setAttribute("data-theme", saved);
  else if (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) root.setAttribute("data-theme", "dark");
  document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
    b.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
    });
  });`
    : ""
}
})();
`;
}

function renderReadme(): string {
  return `# Rebuild starter — bản vanilla HTML/CSS/JS

Mở thẳng \`index.html\` bằng trình duyệt là xem được — KHÔNG cần Node/build.

## File
- \`index.html\` — toàn bộ trang, nội dung thật đã capture.
- \`styles.css\` — CSS variables (palette + dark mode), layout responsive đo được.
- \`script.js\` — menu mobile + nút đổi sáng/tối (nếu site có dark mode).
- \`assets/\` — ảnh đã tải (nếu có).

**Reference only** — thay nội dung/ảnh/branding bằng tài sản gốc của bạn.
`;
}
