import fs from "fs-extra";
import type { Page } from "playwright";
import { CapturePaths } from "./config.js";

export interface Heading {
  tag: string;
  text: string;
}

export interface ButtonInfo {
  text: string;
  role: "button" | "link-cta";
  href?: string;
}

export interface ImageInfo {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export type SectionRole = "header" | "hero" | "features" | "cta" | "content" | "footer";

export interface SectionInfo {
  tag: string;
  index: number;
  role: SectionRole;
  heading: string; // heading đầu tiên trong section
  text: string; // đoạn text mở đầu, cắt ngắn
  childCount: number;
  cardCount: number; // số phần tử lặp (card/grid) phát hiện trong section
  top: number; // vị trí theo trục dọc (px) để sắp thứ tự
  height: number;
}

export interface CardGroup {
  count: number;
  heading: string;
}

export interface LayoutMap {
  headings: Heading[];
  buttons: ButtonInfo[];
  images: ImageInfo[];
  sections: SectionInfo[];
  cards: CardGroup[];
}

/**
 * Bóc tách cấu trúc trang từ DOM live (không Cheerio).
 * Mọi extract chạy trong page.evaluate để thấy được DOM sau khi JS render.
 */
export async function scrapeDom(
  page: Page,
  paths: CapturePaths
): Promise<LayoutMap> {
  await fs.ensureDir(paths.analysis);

  const raw = await page.evaluate(() => {
    const clean = (s: string | null | undefined) =>
      (s ?? "").replace(/\s+/g, " ").trim();

    const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: clean(el.textContent).slice(0, 200),
      }))
      .filter((h) => h.text.length > 0);

    const ctaWords =
      /(button|btn|cta|sign|get|start|buy|try|download|subscribe|contact|join|book|order|shop)/i;
    const buttons: { text: string; role: "button" | "link-cta"; href?: string }[] = [];

    document.querySelectorAll('button, [role="button"]').forEach((el) => {
      const text = clean(el.textContent);
      if (text) buttons.push({ text: text.slice(0, 80), role: "button" });
    });
    document.querySelectorAll("a").forEach((a) => {
      const text = clean(a.textContent);
      const cls = a.className?.toString() ?? "";
      if (text && (ctaWords.test(cls) || ctaWords.test(text))) {
        buttons.push({
          text: text.slice(0, 80),
          role: "link-cta",
          href: a.getAttribute("href") ?? undefined,
        });
      }
    });

    const images = Array.from(document.querySelectorAll("img"))
      .map((img) => {
        const rect = img.getBoundingClientRect();
        return {
          src: img.currentSrc || img.src || "",
          alt: clean(img.getAttribute("alt")),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter((i) => i.src && i.width > 1 && i.height > 1);

    // ---- detect nhóm "card/grid": container có >=3 con cùng cấu trúc ----
    const cardCountIn = (root: Element): number => {
      let best = 0;
      let checked = 0;
      const containers = root.querySelectorAll("ul, ol, div, section");
      for (const c of Array.from(containers)) {
        if (checked++ > 250) break; // chặn chi phí trên trang lớn
        const kids = Array.from(c.children);
        if (kids.length < 3) continue;
        const counts: Record<string, number> = {};
        for (const k of kids) {
          const cls = (k.className?.toString() ?? "").split(/\s+/).slice(0, 2).join(".");
          const sig = `${k.tagName}|${cls}`;
          counts[sig] = (counts[sig] ?? 0) + 1;
        }
        const top = Math.max(...Object.values(counts));
        // chỉ tính khi các con đủ to (card thật, không phải list link nhỏ)
        if (top >= 3) {
          const sampleH = c.getBoundingClientRect().height / Math.max(1, kids.length);
          if (sampleH > 60 && top > best) best = top;
        }
      }
      return best;
    };

    const firstHeadingIn = (el: Element): string => {
      const h = el.querySelector("h1, h2, h3");
      return h ? clean(h.textContent).slice(0, 100) : "";
    };

    // ---- sections: landmark thật ----
    let sectionEls = Array.from(
      document.querySelectorAll("header, main > section, body > section, section, footer")
    );
    // khử trùng (section lồng nhau giữ phần tử ngoài cùng có ý nghĩa)
    sectionEls = sectionEls.filter(
      (el, i, arr) => arr.indexOf(el) === i
    );

    // nếu quá ít landmark, bổ sung "implicit section": con trực tiếp của main/body đủ cao
    if (sectionEls.filter((e) => e.tagName === "SECTION").length < 2) {
      const host = document.querySelector("main") ?? document.body;
      if (host) {
        for (const child of Array.from(host.children)) {
          const r = child.getBoundingClientRect();
          if (r.height > 240 && r.width > 320 && !sectionEls.includes(child)) {
            sectionEls.push(child);
          }
        }
      }
    }

    const sections = sectionEls
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          role: "" as string, // gán ở Node
          heading: firstHeadingIn(el),
          text: clean(el.textContent).slice(0, 120),
          childCount: el.children.length,
          cardCount: cardCountIn(el),
          top: Math.round(r.top + window.scrollY),
          height: Math.round(r.height),
        };
      })
      .filter((s) => s.height > 40)
      .sort((a, b) => a.top - b.top);

    return { headings, buttons, images, sections };
  });

  // ---- gán role section (ở Node để dễ đọc) ----
  const ctaTextRe = /(get started|sign up|try|start|contact|book|demo|subscribe|join|buy)/i;
  const sections: SectionInfo[] = raw.sections.map((s, index) => {
    let role: SectionRole;
    if (s.tag === "header") role = "header";
    else if (s.tag === "footer") role = "footer";
    else if (index <= 1 && (s.heading || s.height > 300) && s.cardCount < 3) role = "hero";
    else if (s.cardCount >= 3) role = "features";
    else if (s.text.length < 200 && ctaTextRe.test(s.text)) role = "cta";
    else role = "content";
    return { ...s, role, index } as SectionInfo;
  });

  // khử trùng lặp button theo text
  const seen = new Set<string>();
  const buttons = raw.buttons.filter((b) => {
    const key = `${b.role}:${b.text.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const cards: CardGroup[] = sections
    .filter((s) => s.cardCount >= 3)
    .map((s) => ({ count: s.cardCount, heading: s.heading }));

  const layout: LayoutMap = {
    headings: raw.headings,
    buttons,
    images: raw.images,
    sections,
    cards,
  };

  await fs.writeJSON(paths.layoutMap, layout, { spaces: 2 });
  console.log(
    `  ✓ DOM scrape: ${layout.headings.length} headings, ${buttons.length} CTAs, ` +
      `${layout.images.length} images, ${sections.length} sections, ${cards.length} card-grids`
  );
  return layout;
}
