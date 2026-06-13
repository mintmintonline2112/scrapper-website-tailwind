import fs from "fs-extra";
import path from "node:path";
import { PageMetadata } from "./capture.js";
import { CapturePaths } from "./config.js";
import { DesignTokens } from "./cluster-tokens.js";
import { ComponentNode, ComponentTree, SectionContent } from "./generate.js";
import { SectionButton, SectionLayout } from "./scrape-dom.js";
import { readableOn } from "./color-utils.js";

/**
 * Phase 6 – sinh starter Next.js + Tailwind THẬT từ tokens + component tree đã giàu nội dung.
 * Nguyên tắc: inline nội dung THẬT đã capture (heading/subtext/CTA), dùng layout ĐO ĐƯỢC
 * (số cột, gap, canh lề, padding) thay vì đoán, và tách danh sách card thành mảng `const`
 * ngay đầu mỗi component để bạn thêm/bớt/sửa text mà không phải đụng JSX.
 */
export async function generateCode(
  meta: PageMetadata,
  tokens: DesignTokens,
  tree: ComponentTree,
  paths: CapturePaths
): Promise<ImageMap> {
  const dir = paths.rebuildDir;
  const componentsDir = path.join(dir, "components");
  const appDir = path.join(dir, "app");
  await fs.emptyDir(dir);
  await fs.ensureDir(componentsDir);
  await fs.ensureDir(appDir);

  // Tải ảnh nổi bật về public/images (đúng kích thước đã đo) để rebuild có ảnh thật.
  const imgMap = await downloadImages(tree, path.join(dir, "public", "images"));
  if (imgMap.size) console.log(`  ✓ tải ${imgMap.size} ảnh → public/images`);

  const sources: { name: string; code: string }[] = [];
  for (const c of tree.components) {
    const code = renderComponent(c, tokens, meta, imgMap);
    sources.push({ name: c.name, code });
    await fs.writeFile(path.join(componentsDir, `${c.name}.tsx`), code, "utf-8");
  }

  await fs.writeFile(path.join(appDir, "page.tsx"), renderPage(tree, meta), "utf-8");
  await fs.writeFile(path.join(appDir, "layout.tsx"), renderLayout(tokens, meta), "utf-8");
  await fs.writeFile(path.join(appDir, "globals.css"), renderGlobals(tokens), "utf-8");
  await fs.writeFile(path.join(dir, "tailwind.config.ts"), renderTailwindConfig(tokens), "utf-8");
  await fs.writeFile(path.join(dir, "preview.html"), renderPreviewHtml(sources, tree, tokens, meta), "utf-8");
  await fs.writeFile(path.join(dir, "README.md"), renderReadme(tree, tokens), "utf-8");

  console.log(
    `  ✓ Phase 6: rebuild/ (${tree.components.length} components + page/layout + globals + tailwind.config.ts + preview.html)`
  );
  return imgMap;
}

// ---------- images ----------

export interface LocalImage {
  file: string; // "/images/img-0.png"
  width: number;
  height: number;
  alt: string;
}
export type ImageMap = Map<string, LocalImage>;

function extFromContentType(ct: string): string | null {
  const m: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
    "image/webp": "webp", "image/svg+xml": "svg", "image/gif": "gif", "image/avif": "avif",
  };
  return m[ct.split(";")[0].trim().toLowerCase()] ?? null;
}
function extFromUrl(url: string): string | null {
  return url.match(/\.(png|jpe?g|webp|svg|gif|avif)(\?|#|$)/i)?.[1].toLowerCase().replace("jpeg", "jpg") ?? null;
}

/** Tải ảnh nổi bật (≥ kích thước tối thiểu) về publicDir, trả map src gốc → ảnh local. */
async function downloadImages(tree: ComponentTree, publicDir: string): Promise<ImageMap> {
  const map: ImageMap = new Map();
  const seen = new Set<string>();
  const candidates = tree.components
    .flatMap((c) => [
      ...(c.data?.images ?? []),
      ...((c.data?.cards ?? []).map((cd) => cd.image).filter((x): x is NonNullable<typeof x> => !!x)),
    ])
    .filter((im) => /^https?:\/\//i.test(im.src) && im.width >= 80 && im.height >= 60)
    .sort((a, b) => b.width * b.height - a.width * a.height);

  const list: typeof candidates = [];
  for (const im of candidates) {
    if (seen.has(im.src)) continue;
    seen.add(im.src);
    list.push(im);
    if (list.length >= 28) break;
  }
  if (!list.length) return map;

  await fs.ensureDir(publicDir);
  let i = 0;
  for (const im of list) {
    try {
      const res = await fetch(im.src, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > 4_000_000 || buf.byteLength < 100) continue;
      const ext = extFromContentType(res.headers.get("content-type") ?? "") ?? extFromUrl(im.src) ?? "img";
      const file = `img-${i++}.${ext}`;
      await fs.writeFile(path.join(publicDir, file), buf);
      map.set(im.src, { file: `/images/${file}`, width: im.width, height: im.height, alt: im.alt });
    } catch {
      /* bỏ ảnh lỗi/timeout */
    }
  }
  return map;
}

/** Ảnh local lớn nhất của section (nếu đã tải được). */
function pickImage(d: SectionContent, imgMap: ImageMap): LocalImage | null {
  const found = d.images
    .map((im) => imgMap.get(im.src))
    .filter((x): x is LocalImage => !!x)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  return found[0] ?? null;
}

// ---------- shared helpers ----------

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

const SPACE_CLASS: Record<number, string> = {
  4: "1", 8: "2", 12: "3", 16: "4", 20: "5", 24: "6",
  32: "8", 40: "10", 48: "12", 56: "14", 64: "16", 80: "20", 96: "24", 128: "32",
};
function nearestSpace(px: number): string {
  const keys = Object.keys(SPACE_CLASS).map(Number);
  let best = keys[0], bestD = Infinity;
  for (const k of keys) {
    const d = Math.abs(k - px);
    if (d < bestD) { bestD = d; best = k; }
  }
  return SPACE_CLASS[best];
}

/** padding dọc section: ưu tiên đo được, fallback token. */
function sectionPad(t: DesignTokens, d?: SectionContent): string {
  if (d && d.layout.paddingY >= 16) return `py-${nearestSpace(d.layout.paddingY)} px-6`;
  return t.tailwindHints.sectionPadding || "py-16 px-6";
}

function gapClass(px: number): string {
  return `gap-${nearestSpace(px > 0 ? px : 24)}`;
}

const clampCol = (n: number) => Math.max(1, Math.min(Math.round(n), 4));

/** Class grid responsive từ số cột ĐO ĐƯỢC ở mobile/tablet/desktop (fallback nếu thiếu). */
function gridCols(layout: SectionLayout, fallback: number): string {
  const d = clampCol(layout.columns || fallback);
  const t = clampCol(layout.columnsTablet ?? Math.min(2, d));
  const m = clampCol(layout.columnsMobile ?? 1);
  const parts = [`grid-cols-${m}`];
  if (t !== m) parts.push(`sm:grid-cols-${t}`);
  if (d !== t) parts.push(`lg:grid-cols-${d}`);
  return parts.join(" ");
}

function alignText(a: "left" | "center" | "right"): string {
  return a === "center" ? "text-center" : a === "right" ? "text-right" : "";
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;")
    .replace(/`/g, "'");
}

/** Mảng object literal an toàn cho file .ts (JSON.stringify cho chuỗi). */
function dataArray(name: string, items: Record<string, unknown>[]): string {
  const body = items
    .map((o) => {
      const fields = Object.entries(o)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(", ");
      return `  { ${fields} },`;
    })
    .join("\n");
  return `const ${name} = [\n${body}\n];`;
}

function brand(meta: PageMetadata): string {
  return esc(meta.title?.split(/[|\-–—·]/)[0]?.trim() || "Brand");
}

function renderButtons(btns: SectionButton[], r: string): string {
  const list = btns.length ? btns : [{ text: "Get started", emphasis: "filled" as const }];
  return list
    .slice(0, 2)
    .map((b) => {
      if (b.emphasis === "filled")
        return `<a href="#" className="${r} bg-[var(--color-primary)] px-6 py-3 font-medium text-[var(--color-on-primary)]">${esc(b.text)}</a>`;
      if (b.emphasis === "outline")
        return `<a href="#" className="${r} border border-[var(--color-border)] px-6 py-3 font-medium">${esc(b.text)}</a>`;
      return `<a href="#" className="px-2 py-3 font-medium text-[var(--color-primary)]">${esc(b.text)}</a>`;
    })
    .join("\n          ");
}

function comp(name: string, body: string, preamble = ""): string {
  return `${preamble ? preamble + "\n\n" : ""}export default function ${name}() {
  return (
    ${body}
  );
}
`;
}

// ---------- per-role renderers ----------

function imgTag(img: LocalImage, className: string): string {
  return `<img src="${img.file}" alt="${esc(img.alt || "")}" width={${img.width}} height={${img.height}} className="${className}" />`;
}

function renderComponent(
  c: ComponentNode,
  t: DesignTokens,
  meta: PageMetadata,
  imgMap: ImageMap = new Map()
): string {
  const r = radiusClass(t);
  const d: SectionContent = c.data ?? {
    heading: "",
    subtext: "",
    buttons: [],
    cards: [],
    images: [],
    layout: { display: "block", columns: 1, gap: 24, maxWidth: "none", align: "left", paddingY: 64 },
  };
  const pad = sectionPad(t, d);
  const align = alignText(d.layout.align);
  const heroImg = pickImage(d, imgMap);

  switch (c.role) {
    case "header": {
      const navLinks = d.buttons.filter((b) => b.emphasis !== "filled").slice(0, 4).map((b) => b.text);
      const links = navLinks.length ? navLinks : ["Features", "Pricing", "Docs", "Company"];
      const cta = d.buttons.find((b) => b.emphasis === "filled")?.text ?? "Get started";
      return comp(
        c.name,
        `<header className="border-b border-[var(--color-border)]">
      <nav className="${container(t)} flex h-16 items-center justify-between">
        <span className="text-lg font-bold">${brand(meta)}</span>
        <ul className="hidden gap-8 text-sm md:flex">
          {links.map((l) => (
            <li key={l}><a href="#" className="opacity-70 hover:opacity-100">{l}</a></li>
          ))}
        </ul>
        <a href="#" className="${r} bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-on-primary)]">${esc(cta)}</a>
      </nav>
    </header>`,
        `const links = ${JSON.stringify(links)};`
      );
    }

    case "hero":
      return comp(
        c.name,
        `<section className="${pad}">
      <div className="${container(t)} ${align || "text-center"}">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          ${esc(d.heading || "A clear, original headline goes here")}
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg opacity-70">
          ${esc(d.subtext || "Placeholder subheading — replace with your own value proposition.")}
        </p>
        <div className="mt-8 flex ${d.layout.align === "left" ? "" : "justify-center"} gap-4">
          ${renderButtons(d.buttons, r)}
        </div>
        ${heroImg ? `${imgTag(heroImg, `mx-auto mt-12 h-auto w-full max-w-4xl ${r} border border-[var(--color-border)]`)}` : ""}
      </div>
    </section>`
      );

    case "features": {
      const cards = (d.cards.length ? d.cards : fallbackCards(3)).map((c2) => {
        const li = c2.image ? imgMap.get(c2.image.src) : null;
        return {
          heading: c2.heading || "Feature",
          text: c2.text || "Short placeholder description of this feature or benefit.",
          img: li ? li.file : "",
        };
      });
      return comp(
        c.name,
        `<section className="${pad}">
      <div className="${container(t)}">
        ${d.heading ? `<h2 className="mb-10 text-center text-3xl font-bold">${esc(d.heading)}</h2>` : ""}
        <div className="grid ${gapClass(d.layout.gap)} ${gridCols(d.layout, cards.length)}">
          {items.map((item) => (
            <div key={item.heading} className="overflow-hidden ${r} border border-[var(--color-border)]">
              {item.img ? (
                <img src={item.img} alt={item.heading} className="h-44 w-full object-cover" />
              ) : null}
              <div className="p-6">
                {!item.img ? <div className="${r} mb-4 h-10 w-10 bg-[var(--color-primary)]/10" /> : null}
                <h3 className="text-lg font-semibold">{item.heading}</h3>
                <p className="mt-2 text-sm opacity-70">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>`,
        dataArray("items", cards)
      );
    }

    case "pricing": {
      const plans = (d.cards.length ? d.cards : fallbackCards(3)).slice(0, 4).map((c2, i) => ({
        name: c2.heading || `Plan ${i + 1}`,
        desc: c2.text || "What this plan includes.",
        featured: i === 1,
      }));
      const cols = Math.min(Math.max(plans.length, 2), 4);
      return comp(
        c.name,
        `<section className="${pad}">
      <div className="${container(t)}">
        <h2 className="mb-10 text-center text-3xl font-bold">${esc(d.heading || "Pricing")}</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-${cols}">
          {plans.map((p) => (
            <div key={p.name} className={\`${r} border p-6 \${p.featured ? "border-[var(--color-primary)] shadow-lg" : "border-[var(--color-border)]"}\`}>
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <p className="mt-1 text-sm opacity-70">{p.desc}</p>
              <p className="mt-4 text-3xl font-bold">$—<span className="text-sm font-normal opacity-60">/mo</span></p>
              <a href="#" className="${r} mt-6 block ${"" /* nút */} bg-[var(--color-primary)] py-2.5 text-center text-sm font-medium text-[var(--color-on-primary)]">Choose</a>
            </div>
          ))}
        </div>
      </div>
    </section>`,
        dataArray("plans", plans)
      );
    }

    case "testimonial": {
      const quotes = (d.cards.length ? d.cards : fallbackCards(3)).slice(0, 6).map((c2, i) => ({
        quote: c2.text || "This product changed how our team works.",
        author: c2.heading || `Customer ${i + 1}`,
      }));
      return comp(
        c.name,
        `<section className="${pad}">
      <div className="${container(t)}">
        ${d.heading ? `<h2 className="mb-10 text-center text-3xl font-bold">${esc(d.heading)}</h2>` : ""}
        <div className="grid ${gapClass(d.layout.gap)} ${gridCols(d.layout, Math.min(quotes.length, 3))}">
          {quotes.map((q) => (
            <figure key={q.author} className="${r} border border-[var(--color-border)] p-6">
              <blockquote className="text-sm leading-relaxed">“{q.quote}”</blockquote>
              <figcaption className="mt-4 flex items-center gap-3">
                <span className="h-8 w-8 rounded-full bg-[var(--color-primary)]/20" />
                <span className="text-sm font-medium">{q.author}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>`,
        dataArray("quotes", quotes)
      );
    }

    case "logos": {
      const n = Math.min(Math.max(c.cardCount ?? d.images.length ?? 5, 4), 8);
      return comp(
        c.name,
        `<section className="${pad}">
      <div className="${container(t)} text-center">
        ${d.heading ? `<p className="mb-8 text-sm font-medium uppercase tracking-wide opacity-60">${esc(d.heading)}</p>` : ""}
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
          {Array.from({ length: ${n} }).map((_, i) => (
            <div key={i} className="h-8 w-28 rounded bg-[var(--color-text)]/10" />
          ))}
        </div>
      </div>
    </section>`
      );
    }

    case "stats": {
      const stats = (d.cards.length ? d.cards : fallbackCards(3)).slice(0, 4).map((c2, i) => ({
        value: c2.heading || `${(i + 1) * 25}%`,
        label: c2.text || "Key metric",
      }));
      return comp(
        c.name,
        `<section className="${pad}">
      <div className="${container(t)}">
        ${d.heading ? `<h2 className="mb-10 text-center text-3xl font-bold">${esc(d.heading)}</h2>` : ""}
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-${Math.min(Math.max(stats.length, 2), 4)} text-center">
          {stats.map((s) => (
            <div key={s.label}>
              <div className="text-4xl font-bold text-[var(--color-primary)]">{s.value}</div>
              <div className="mt-1 text-sm opacity-70">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>`,
        dataArray("stats", stats)
      );
    }

    case "faq": {
      const faqs = (d.cards.length ? d.cards : fallbackCards(4)).slice(0, 8).map((c2, i) => ({
        q: c2.heading || `Question ${i + 1}?`,
        a: c2.text || "Placeholder answer to this frequently asked question.",
      }));
      return comp(
        c.name,
        `<section className="${pad}">
      <div className="mx-auto max-w-3xl px-6">
        <h2 className="mb-10 text-center text-3xl font-bold">${esc(d.heading || "FAQ")}</h2>
        <div className="divide-y divide-[var(--color-border)]">
          {faqs.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="cursor-pointer list-none font-medium">{f.q}</summary>
              <p className="mt-2 text-sm opacity-70">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>`,
        dataArray("faqs", faqs)
      );
    }

    case "cta":
      return comp(
        c.name,
        `<section className="${pad}">
      <div className="${container(t)} ${r} bg-[var(--color-primary)] px-8 py-16 text-center text-[var(--color-on-primary)]">
        <h2 className="text-3xl font-bold">${esc(d.heading || "Ready to get started?")}</h2>
        <p className="mx-auto mt-4 max-w-lg opacity-80">${esc(d.subtext || "Placeholder supporting copy for the call to action.")}</p>
        <a href="#" className="${r} mt-8 inline-block bg-[var(--color-bg)] px-6 py-3 font-medium text-[var(--color-primary)]">${esc(d.buttons[0]?.text || "Get started")}</a>
      </div>
    </section>`
      );

    case "footer":
      return comp(
        c.name,
        `<footer className="border-t border-[var(--color-border)] ${pad}">
      <div className="${container(t)} grid grid-cols-2 gap-8 md:grid-cols-4">
        {cols.map((col) => (
          <div key={col.title}>
            <h4 className="mb-3 text-sm font-semibold">{col.title}</h4>
            <ul className="space-y-2 text-sm opacity-60">
              {col.links.map((l) => (
                <li key={l}><a href="#" className="hover:opacity-100">{l}</a></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="${container(t)} mt-10 text-sm opacity-50">© ${"{new Date().getFullYear()}"} ${brand(meta)}. Rebuilt for reference.</p>
    </footer>`,
        `const cols = [
  { title: "Product", links: ["Features", "Pricing", "Docs"] },
  { title: "Company", links: ["About", "Blog", "Careers"] },
  { title: "Resources", links: ["Guides", "Support", "API"] },
  { title: "Legal", links: ["Privacy", "Terms"] },
];`
      );

    default:
      if (heroImg)
        return comp(
          c.name,
          `<section className="${pad}">
      <div className="${container(t)} grid items-center gap-12 md:grid-cols-2">
        <div>
          ${d.heading ? `<h2 className="text-3xl font-bold">${esc(d.heading)}</h2>` : ""}
          ${d.subtext ? `<p className="mt-4 max-w-xl opacity-70">${esc(d.subtext)}</p>` : ""}
        </div>
        ${imgTag(heroImg, `h-auto w-full ${r} border border-[var(--color-border)]`)}
      </div>
    </section>`
        );
      return comp(
        c.name,
        `<section className="${pad}">
      <div className="${container(t)} ${align}">
        ${d.heading ? `<h2 className="mb-6 text-3xl font-bold">${esc(d.heading)}</h2>` : ""}
        ${d.subtext ? `<p className="max-w-2xl opacity-70">${esc(d.subtext)}</p>` : ""}
      </div>
    </section>`
      );
  }
}

function fallbackCards(n: number): SectionContent["cards"] {
  return Array.from({ length: n }, () => ({ heading: "", text: "", hasIcon: false, hasImage: false }));
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

// Bộ Google Fonts phổ biến — để quyết định có nên nhúng <link> không (tránh 404 với font tự host).
const GOOGLE_FONTS = new Set(
  [
    "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Raleway",
    "Nunito", "Nunito Sans", "Work Sans", "Source Sans Pro", "Source Sans 3",
    "Mulish", "Rubik", "Karla", "DM Sans", "DM Serif Display", "Manrope", "Outfit",
    "Plus Jakarta Sans", "Space Grotesk", "Sora", "Figtree", "Lexend", "Epilogue",
    "Playfair Display", "Merriweather", "Lora", "PT Sans", "PT Serif", "Noto Sans",
    "Noto Serif", "Roboto Slab", "Roboto Mono", "Roboto Condensed", "Oswald",
    "Bebas Neue", "Barlow", "Cabin", "Quicksand", "Josefin Sans", "Heebo",
    "IBM Plex Sans", "IBM Plex Mono", "IBM Plex Serif", "Fira Sans", "Fira Code",
    "Archivo", "Hanken Grotesk", "Albert Sans", "Onest", "Geist", "Geist Mono",
  ].map((f) => f.toLowerCase())
);

/** Nếu font chủ đạo là Google Font → trả {name,url} để nhúng <link>. */
export function detectGoogleFont(t: DesignTokens, meta: PageMetadata): { name: string; url: string } | null {
  const names = [...t.fonts, ...meta.webFonts];
  for (const raw of names) {
    const name = raw.replace(/["']/g, "").trim();
    if (!name || !GOOGLE_FONTS.has(name.toLowerCase())) continue;
    const weights = (t.fontWeights.length ? t.fontWeights : [400, 700])
      .filter((w, i, a) => a.indexOf(w) === i)
      .sort((a, b) => a - b)
      .join(";");
    const url = `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, "+")}:wght@${weights}&display=swap`;
    return { name, url };
  }
  return null;
}

/** app/layout.tsx — root layout BẮT BUỘC của Next App Router (+ nhúng Google Font nếu nhận ra). */
function renderLayout(t: DesignTokens, meta: PageMetadata): string {
  const gf = detectGoogleFont(t, meta);
  const lang = (meta.lang || "en").split("-")[0] || "en";
  const head = gf
    ? `
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="${gf.url}" rel="stylesheet" />`
    : "";
  return `import "./globals.css";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="${lang}">
      <body>${head}
        {children}
      </body>
    </html>
  );
}
`;
}

function cssVars(t: DesignTokens): string {
  return `:root {
  --color-bg: ${t.palette.background};
  --color-text: ${t.palette.text};
  --color-primary: ${t.palette.primary};
  --color-accent: ${t.palette.accent};
  --color-border: ${t.palette.border};
  /* màu chữ đọc được trên nền primary (đen/trắng theo tương phản WCAG) */
  --color-on-primary: ${readableOn(t.palette.primary)};
}`;
}

function darkVars(t: DesignTokens): string {
  const d = t.darkPalette;
  if (!d) return "";
  return `

/* Dark mode đo từ prefers-color-scheme:dark của site gốc. Bật bằng class "dark" trên <html>. */
.dark {
  --color-bg: ${d.background};
  --color-text: ${d.text};
  --color-primary: ${d.primary};
  --color-accent: ${d.accent};
  --color-border: ${d.border};
  --color-on-primary: ${readableOn(d.primary)};
}`;
}

function renderGlobals(t: DesignTokens): string {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

${cssVars(t)}${darkVars(t)}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: ${t.fonts[0] ? `"${t.fonts[0]}", ` : ""}system-ui, sans-serif;
}
`;
}

/** tailwind.config.ts drop-in: map token màu/spacing/type sang theme.extend. */
function renderTailwindConfig(t: DesignTokens): string {
  const spacing = t.spacingScale.reduce<Record<string, string>>((m, px) => { m[`s${px}`] = `${px}px`; return m; }, {});
  const fontSize = t.typeScale.reduce<Record<string, string>>((m, px) => { m[`t${px}`] = `${px}px`; return m; }, {});
  const borderRadius = t.radiusScale.reduce<Record<string, string>>((m, px) => { m[`r${px}`] = px >= 9999 ? "9999px" : `${px}px`; return m; }, {});
  const theme = {
    colors: {
      bg: "var(--color-bg)",
      text: "var(--color-text)",
      primary: "var(--color-primary)",
      accent: "var(--color-accent)",
      border: "var(--color-border)",
      "on-primary": "var(--color-on-primary)",
    },
    fontFamily: { sans: [t.fonts[0] || "system-ui", "sans-serif"] },
    fontSize,
    spacing,
    borderRadius,
  };
  return `import type { Config } from "tailwindcss";

// Sinh tự động từ design tokens. Màu trỏ vào CSS variable (xem app/globals.css)
// để đổi theme/dark-mode chỉ cần sửa biến, không phải sửa config.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],${t.darkPalette ? `\n  darkMode: "class",` : ""}
  theme: {
    extend: ${JSON.stringify(theme, null, 6).replace(/\n/g, "\n  ")},
  },
  plugins: [],
};

export default config;
`;
}

/**
 * preview.html tự chứa — tái dùng NGUYÊN code component (React UMD + Babel standalone +
 * Tailwind Play CDN). Mở trực tiếp bằng file:// hoặc nhúng iframe trong dashboard để xem
 * ngay, không cần dựng app Next. Ảnh tham chiếu tương đối public/images để file:// chạy.
 */
function renderPreviewHtml(
  sources: { name: string; code: string }[],
  tree: ComponentTree,
  t: DesignTokens,
  meta: PageMetadata
): string {
  const gf = detectGoogleFont(t, meta);
  const fontLink = gf
    ? `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="${gf.url}" rel="stylesheet">`
    : "";
  // Bọc mỗi component trong IIFE: các `const items/plans/quotes...` ở đầu component
  // thành scope riêng, tránh trùng tên khi gộp mọi component vào CHUNG một <script>
  // (trong app Next mỗi component là module riêng nên không trùng — preview gộp mới cần).
  const scripts = sources
    .map((s) => {
      const inner = s.code
        .replace(`export default function ${s.name}`, `return function ${s.name}`)
        .replace(/src="\/images\//g, 'src="public/images/');
      return `const ${s.name} = (() => {\n${inner}\n})();`;
    })
    .join("\n\n");
  const usage = tree.components.map((c) => `<${c.name} />`).join("\n        ");
  const bodyFont = t.fonts[0] ? `"${t.fonts[0]}", ` : "";
  const lang = (meta.lang || "en").split("-")[0] || "en";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title || "Preview")}</title>
${fontLink}
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config = { darkMode: "class" };</script>
<style>
${cssVars(t)}${darkVars(t)}
html, body { margin: 0; }
body { background: var(--color-bg); color: var(--color-text); font-family: ${bodyFont}system-ui, sans-serif; }
</style>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body>
<div id="root"></div>
<script type="text/babel" data-presets="react,typescript">
${scripts}

function Page() {
  return (
    <main className="min-h-screen">
        ${usage}
    </main>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<Page />);
</script>
</body>
</html>
`;
}

function renderReadme(tree: ComponentTree, t: DesignTokens): string {
  return `# Rebuild starter (generated)

Starter Next.js (App Router) + Tailwind sinh tự động từ design tokens + nội dung đã capture.
**Reference only** — thay nội dung/ảnh/branding bằng tài sản gốc của bạn.

## Dùng
1. Tạo app Next.js + Tailwind (\`npx create-next-app@latest --tailwind\`).
2. Copy \`app/page.tsx\`, \`app/globals.css\`, \`components/*.tsx\`, và \`tailwind.config.ts\` vào app.
3. Mỗi component có mảng \`const\` nội dung ngay đầu file — sửa text/thêm/bớt item ở đó.

## Tokens chính
- primary \`${t.palette.primary}\` · accent \`${t.palette.accent}\` · bg \`${t.palette.background}\` · text \`${t.palette.text}\`
- container \`${t.tailwindHints.containerMaxWidth}\` · section padding \`${t.tailwindHints.sectionPadding}\`

## Components
${tree.components.map((c) => `- \`${c.name}.tsx\` (${c.role})`).join("\n")}
`;
}
