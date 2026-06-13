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

export type SectionRole =
  | "header"
  | "hero"
  | "features"
  | "pricing"
  | "testimonial"
  | "logos"
  | "faq"
  | "stats"
  | "cta"
  | "content"
  | "footer";

/** Nút nằm trong một section (giữ thứ tự xuất hiện). */
export interface SectionButton {
  text: string;
  href?: string;
  /** filled = nút nền đặc (CTA chính), outline = viền, link = text thường */
  emphasis: "filled" | "outline" | "link";
}

/** Một "card" lặp lại trong section (feature/pricing/testimonial…). */
export interface CardInfo {
  heading: string;
  text: string;
  hasIcon: boolean;
  hasImage: boolean;
  /** ảnh thumbnail của card (nếu có) — để codegen render thật thay vì ô xám */
  image?: ImageInfo;
}

/** Layout ĐO ĐƯỢC của section — để codegen sinh Tailwind khớp, không đoán. */
export interface SectionLayout {
  display: "grid" | "flex" | "block";
  columns: number; // số cột ở desktop (>=1)
  columnsTablet?: number; // số cột đo ở 768px
  columnsMobile?: number; // số cột đo ở 390px
  gap: number; // px
  maxWidth: string; // computed max-width hoặc "none"
  align: "left" | "center" | "right";
  paddingY: number; // padding dọc (px)
}

/** Tín hiệu thô để gán role chính xác hơn (đo ở browser, phân loại ở Node). */
export interface SectionSignals {
  details: number; // số <details> (FAQ)
  quotes: number; // số <blockquote>/<q> (testimonial)
  numericRatio: number; // tỉ lệ card có nội dung chủ yếu là số (stats)
  smallImages: number; // số ảnh/logo nhỏ xếp hàng (logo cloud)
  priceHits: number; // số lần khớp mẫu giá ($/mo…)
}

export interface SectionInfo {
  tag: string;
  index: number;
  role: SectionRole;
  heading: string; // heading đầu tiên trong section
  subtext: string; // đoạn mô tả đầu tiên
  text: string; // text mở đầu, cắt ngắn (giữ cho report)
  buttons: SectionButton[];
  images: ImageInfo[];
  childCount: number;
  cardCount: number; // số phần tử lặp (card/grid) phát hiện
  cards: CardInfo[];
  layout: SectionLayout;
  signals: SectionSignals;
  top: number;
  height: number;
  width: number;
  linkCount: number;
  /** là thanh full-width mỏng trên cùng (ứng viên header div-based) */
  isTopBar: boolean;
  hasCopyright: boolean;
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
 * Bóc tách cấu trúc + nội dung + layout đo được từ DOM live (không Cheerio).
 * Mọi extract chạy trong page.evaluate để thấy DOM sau khi JS render.
 */
export async function scrapeDom(
  page: Page,
  paths: CapturePaths
): Promise<LayoutMap> {
  await fs.ensureDir(paths.analysis);

  const raw = await page.evaluate(() => {
    const clean = (s: string | null | undefined) =>
      (s ?? "").replace(/\s+/g, " ").trim();

    const ctaWords =
      /(button|btn|cta|sign|get|start|buy|try|download|subscribe|contact|join|book|order|shop)/i;
    const priceRe =
      /(\$\s?\d|€\s?\d|£\s?\d|₫|\bvnd\b|\d+\s*(\/|per)\s*(mo|month|yr|year))/i;

    // ---------- helpers đo lường ----------
    const pxNum = (v: string): number => {
      const m = v.match(/-?\d+(\.\d+)?/);
      return m ? Math.round(parseFloat(m[0])) : 0;
    };

    const buttonEmphasis = (el: Element): "filled" | "outline" | "link" => {
      const cs = getComputedStyle(el);
      const a = cs.backgroundColor.match(/[\d.]+/g);
      const filled = !!a && (a[3] === undefined || parseFloat(a[3]) > 0.1) &&
        !(a[0] === "0" && a[1] === "0" && a[2] === "0" && cs.backgroundColor.includes("0)"));
      const hasBg = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
      if (hasBg && filled) return "filled";
      if (parseFloat(cs.borderTopWidth) > 0) return "outline";
      return "link";
    };

    const headingIn = (el: Element): string => {
      const h = el.querySelector("h1, h2, h3, h4");
      return h ? clean(h.textContent).slice(0, 120) : "";
    };

    const subtextIn = (el: Element, heading: string): string => {
      const ps = Array.from(el.querySelectorAll("p"));
      for (const p of ps) {
        const t = clean(p.textContent);
        if (t.length > 30 && t !== heading) return t.slice(0, 240);
      }
      return "";
    };

    const buttonsIn = (el: Element): {
      text: string;
      href?: string;
      emphasis: "filled" | "outline" | "link";
    }[] => {
      const out: { text: string; href?: string; emphasis: "filled" | "outline" | "link" }[] = [];
      const seen = new Set<string>();
      el.querySelectorAll('a, button, [role="button"]').forEach((b) => {
        const text = clean(b.textContent);
        if (!text || text.length > 40) return;
        const isBtn = b.tagName === "BUTTON" || b.getAttribute("role") === "button";
        const cls = (b as HTMLElement).className?.toString() ?? "";
        const looksCta = isBtn || ctaWords.test(cls) || ctaWords.test(text);
        if (!looksCta) return;
        const key = text.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push({
          text,
          href: b.getAttribute("href") ?? undefined,
          emphasis: buttonEmphasis(b),
        });
      });
      return out.slice(0, 4);
    };

    const imagesIn = (el: Element): {
      src: string;
      alt: string;
      width: number;
      height: number;
    }[] =>
      Array.from(el.querySelectorAll("img"))
        .map((img) => {
          const r = img.getBoundingClientRect();
          return {
            src: img.currentSrc || img.src || "",
            alt: clean(img.getAttribute("alt")),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        })
        .filter((i) => i.src && i.width > 1 && i.height > 1)
        .slice(0, 6);

    // ---- container card/grid tốt nhất trong section + nội dung từng card ----
    const cardInfoFrom = (child: Element): {
      heading: string;
      text: string;
      hasIcon: boolean;
      hasImage: boolean;
      image?: { src: string; alt: string; width: number; height: number };
    } => {
      const h = child.querySelector("h1,h2,h3,h4,h5,h6,strong,b");
      let heading = h ? clean(h.textContent).slice(0, 80) : "";
      // ưu tiên <p> để tránh nuốt cả heading; fallback: text của card trừ phần heading
      const p = Array.from(child.querySelectorAll("p"))
        .map((e) => clean(e.textContent))
        .find((t) => t.length > 20);
      let text = p || clean(child.textContent);
      if (heading && text.startsWith(heading)) text = text.slice(heading.length).trim();
      text = text.slice(0, 160);
      if (!heading) heading = clean(child.textContent).slice(0, 60);
      const imgs = Array.from(child.querySelectorAll("img, svg"));
      const hasIcon = imgs.some((i) => {
        const r = i.getBoundingClientRect();
        return r.width > 0 && r.width <= 64;
      }) || !!child.querySelector('[class*="icon" i]');
      const hasImage = imgs.some((i) => i.getBoundingClientRect().width > 64);
      // thumbnail thật của card: <img> lớn nhất (bỏ icon nhỏ)
      const thumb = Array.from(child.querySelectorAll("img"))
        .map((im) => ({ im, r: im.getBoundingClientRect() }))
        .filter((x) => x.r.width >= 48 && x.r.height >= 36)
        .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
      const image = thumb
        ? {
            src: thumb.im.currentSrc || thumb.im.src || "",
            alt: clean(thumb.im.getAttribute("alt")),
            width: Math.round(thumb.r.width),
            height: Math.round(thumb.r.height),
          }
        : undefined;
      return { heading, text, hasIcon, hasImage, image: image?.src ? image : undefined };
    };

    const bestCardGroup = (root: Element): {
      count: number;
      container: Element | null;
      cards: ReturnType<typeof cardInfoFrom>[];
    } => {
      let best = 0;
      let bestContainer: Element | null = null;
      let bestSig = "";
      let checked = 0;
      const containers = root.querySelectorAll("ul, ol, div, section");
      for (const c of Array.from(containers)) {
        if (checked++ > 250) break;
        const kids = Array.from(c.children);
        if (kids.length < 3) continue;
        const counts: Record<string, number> = {};
        for (const k of kids) {
          const cls = (k.className?.toString() ?? "").split(/\s+/).slice(0, 2).join(".");
          counts[`${k.tagName}|${cls}`] = (counts[`${k.tagName}|${cls}`] ?? 0) + 1;
        }
        let topSig = "";
        let topN = 0;
        for (const [sig, n] of Object.entries(counts)) if (n > topN) { topN = n; topSig = sig; }
        if (topN >= 3) {
          const sampleH = c.getBoundingClientRect().height / Math.max(1, kids.length);
          if (sampleH > 60 && topN > best) {
            best = topN;
            bestContainer = c;
            bestSig = topSig;
          }
        }
      }
      let cards: ReturnType<typeof cardInfoFrom>[] = [];
      if (bestContainer) {
        cards = Array.from(bestContainer.children)
          .filter((k) => {
            const cls = (k.className?.toString() ?? "").split(/\s+/).slice(0, 2).join(".");
            return `${k.tagName}|${cls}` === bestSig;
          })
          .slice(0, 8)
          .map(cardInfoFrom);
      }
      return { count: best, container: bestContainer, cards };
    };

    // ---- đo layout của section (ưu tiên container card nếu có) ----
    const measureLayout = (el: Element, container: Element | null) => {
      const target = container ?? el;
      const cs = getComputedStyle(target);
      const display: "grid" | "flex" | "block" = cs.display.includes("grid")
        ? "grid"
        : cs.display.includes("flex")
        ? "flex"
        : "block";

      let columns = 1;
      if (display === "grid" && cs.gridTemplateColumns && cs.gridTemplateColumns !== "none") {
        columns = cs.gridTemplateColumns.split(/\s+/).filter(Boolean).length || 1;
      } else if (display === "flex") {
        const kids = Array.from(target.children).filter(
          (k) => k.getBoundingClientRect().width > 0
        );
        if (kids.length) {
          const firstTop = kids[0].getBoundingClientRect().top;
          columns = kids.filter(
            (k) => Math.abs(k.getBoundingClientRect().top - firstTop) < 8
          ).length || 1;
        }
      }
      columns = Math.max(1, Math.min(columns, 6));

      const gap = pxNum(cs.columnGap !== "normal" ? cs.columnGap : cs.gap || "0");
      const sectionCs = getComputedStyle(el);
      const ta = sectionCs.textAlign;
      const align: "left" | "center" | "right" =
        ta === "center" ? "center" : ta === "right" || ta === "end" ? "right" : "left";
      const paddingY = Math.round(
        (pxNum(sectionCs.paddingTop) + pxNum(sectionCs.paddingBottom)) / 2
      );

      // max-width của chính section hoặc con bị giới hạn rộng nhất
      let maxWidth = sectionCs.maxWidth;
      if (!maxWidth || maxWidth === "none") {
        const inner = Array.from(el.querySelectorAll<HTMLElement>("div")).find((d) => {
          const mw = getComputedStyle(d).maxWidth;
          return mw && mw !== "none" && /\d/.test(mw);
        });
        maxWidth = inner ? getComputedStyle(inner).maxWidth : "none";
      }
      return { display, columns, gap, maxWidth, align, paddingY };
    };

    // ---- tín hiệu phân loại role ----
    const signalsFor = (
      el: Element,
      cards: ReturnType<typeof cardInfoFrom>[]
    ): {
      details: number;
      quotes: number;
      numericRatio: number;
      smallImages: number;
      priceHits: number;
    } => {
      const details = el.querySelectorAll("details").length;
      const quotes = el.querySelectorAll("blockquote, q").length;
      const numericCards = cards.filter((c) =>
        /^[^\w]*[\d.,]+\s*[%+kKmM]?[^\w]*$/.test(c.heading.trim())
      ).length;
      const numericRatio = cards.length ? numericCards / cards.length : 0;
      const smallImages = Array.from(el.querySelectorAll("img, svg")).filter((i) => {
        const r = i.getBoundingClientRect();
        return r.width >= 24 && r.width <= 200 && r.height >= 12 && r.height <= 120;
      }).length;
      const priceHits = (clean(el.textContent).match(priceRe) ? 1 : 0) +
        cards.filter((c) => priceRe.test(c.text) || priceRe.test(c.heading)).length;
      return { details, quotes, numericRatio, smallImages, priceHits };
    };

    // ===== headings / buttons / images toàn trang (giữ tương thích) =====
    const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: clean(el.textContent).slice(0, 200),
      }))
      .filter((h) => h.text.length > 0);

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

    // ===== sections =====
    const vw = window.innerWidth;
    // Bỏ element ẩn/modal (visibility:hidden, display:none, opacity≈0, aria-hidden, off-screen).
    // → loại các share/filter modal bị nhận nhầm là <header>.
    const isVisible = (el: Element): boolean => {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.visibility === "collapse" || cs.display === "none")
        return false;
      if (parseFloat(cs.opacity || "1") < 0.05) return false;
      if (el.closest('[aria-hidden="true"]')) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (r.bottom < 0 || r.right < 0) return false;
      return true;
    };
    const copyRe = /(©|copyright|bản quyền|all rights reserved)/i;

    let sectionEls = Array.from(
      document.querySelectorAll(
        'header, [role="banner"], main > section, body > section, section, footer, [role="contentinfo"]'
      )
    ).filter((el, i, arr) => arr.indexOf(el) === i && isVisible(el));

    // Header div-based: thanh full-width mỏng trên cùng có ≥3 link nav (nhiều site không dùng <header>).
    const headerBar = (() => {
      const cands = Array.from(document.querySelectorAll("div, nav")).filter((el) => {
        if (!isVisible(el)) return false;
        const r = el.getBoundingClientRect();
        return (
          r.top + window.scrollY < 140 &&
          r.width >= vw * 0.8 &&
          r.height >= 36 &&
          r.height <= 170 &&
          el.querySelectorAll("a").length >= 3
        );
      });
      cands.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return ra.top - rb.top || rb.width - ra.width; // trên cùng, ngoài cùng
      });
      return cands[0] ?? null;
    })();
    const hasVisibleHeaderLandmark = sectionEls.some(
      (e) => e.tagName === "HEADER" || e.getAttribute("role") === "banner"
    );
    if (headerBar && !hasVisibleHeaderLandmark && !sectionEls.includes(headerBar)) {
      sectionEls.unshift(headerBar);
    }

    // Footer div-based nếu không có <footer> hiển thị: block full-width dưới cùng có copyright + link.
    if (!sectionEls.some((e) => e.tagName === "FOOTER")) {
      const fcands = Array.from(document.querySelectorAll("div, footer")).filter((el) => {
        if (!isVisible(el)) return false;
        const r = el.getBoundingClientRect();
        return (
          r.width >= vw * 0.8 &&
          r.height >= 80 &&
          copyRe.test(el.textContent || "") &&
          el.querySelectorAll("a").length >= 3
        );
      });
      const footerBar = fcands[fcands.length - 1];
      if (footerBar && !sectionEls.includes(footerBar)) sectionEls.push(footerBar);
    }

    // Bổ sung block lớn (hiển thị) nếu vẫn quá ít section thật.
    if (sectionEls.filter((e) => e.tagName === "SECTION").length < 2) {
      const host = document.querySelector("main") ?? document.body;
      if (host) {
        for (const child of Array.from(host.children)) {
          if (!isVisible(child)) continue;
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
        const heading = headingIn(el);
        const group = bestCardGroup(el);
        const layout = measureLayout(el, group.container);
        const signals = signalsFor(el, group.cards);
        const top = Math.round(r.top + window.scrollY);
        const linkCount = el.querySelectorAll("a").length;
        const isTopBar =
          top < 140 && r.width >= vw * 0.8 && r.height <= 170 && linkCount >= 3;
        return {
          tag: el.tagName.toLowerCase(),
          role: "" as string,
          heading,
          subtext: subtextIn(el, heading),
          text: clean(el.textContent).slice(0, 120),
          buttons: buttonsIn(el),
          images: imagesIn(el),
          childCount: el.children.length,
          cardCount: group.count,
          cards: group.cards,
          layout,
          signals,
          top,
          height: Math.round(r.height),
          width: Math.round(r.width),
          linkCount,
          isTopBar,
          hasCopyright: copyRe.test(clean(el.textContent).slice(0, 600)),
        };
      })
      .filter((s) => s.height > 40)
      .sort((a, b) => a.top - b.top);

    return { headings, buttons, images, sections };
  });

  // ---- gán role section (ở Node) ----
  const ctaTextRe = /(get started|sign up|try|start|contact|book|demo|subscribe|join|buy)/i;
  const lastIdx = raw.sections.length - 1;
  const sections: SectionInfo[] = raw.sections.map((s, index) => {
    const sig = s.signals;
    let role: SectionRole;
    // header/footer nhận theo geometry, KHÔNG chỉ theo thẻ (layout div-based)
    if (s.tag === "header" || (s.isTopBar && index <= 1)) role = "header";
    else if (s.tag === "footer" || (index === lastIdx && s.hasCopyright && s.linkCount >= 3))
      role = "footer";
    else if (sig.details >= 2 || (/faq|frequently asked|câu hỏi/i.test(s.heading))) role = "faq";
    else if (sig.priceHits >= 2 && s.cardCount >= 2) role = "pricing";
    else if (sig.quotes >= 1 || /testimonial|review|khách hàng nói|what .* say/i.test(s.heading)) role = "testimonial";
    else if (s.cardCount >= 3 && sig.numericRatio >= 0.5) role = "stats";
    else if (s.cardCount >= 4 && sig.smallImages >= 4 && s.heading.length < 40 && s.cards.every((c) => c.text.length < 30)) role = "logos";
    else if (index <= 1 && (s.heading || s.height > 300) && s.cardCount < 3) role = "hero";
    else if (s.cardCount >= 3) role = "features";
    else if (s.text.length < 200 && ctaTextRe.test(s.text)) role = "cta";
    else role = "content";
    return { ...s, role, index } as SectionInfo;
  });

  // khử trùng button toàn trang theo text
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
  const roleSummary = sections.map((s) => s.role).join(", ");
  console.log(
    `  ✓ DOM scrape: ${layout.headings.length} headings, ${buttons.length} CTAs, ` +
      `${layout.images.length} images, ${sections.length} sections [${roleSummary}]`
  );
  return layout;
}

/**
 * Đo lại SỐ CỘT của từng section ở viewport hiện tại (gọi sau khi setViewportSize).
 * Dùng CÙNG cách chọn section như scrapeDom nên kết quả align theo index → ghép được
 * vào layout desktop để sinh responsive grid chính xác. Chạy trên cùng page (reflow,
 * không reload) nên rất nhanh.
 */
export async function measureSectionColumns(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    // ---- chọn section giống scrapeDom (PHẢI khớp để index align) ----
    const vw = window.innerWidth;
    const isVisible = (el: Element): boolean => {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.visibility === "collapse" || cs.display === "none")
        return false;
      if (parseFloat(cs.opacity || "1") < 0.05) return false;
      if (el.closest('[aria-hidden="true"]')) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (r.bottom < 0 || r.right < 0) return false;
      return true;
    };
    const copyRe = /(©|copyright|bản quyền|all rights reserved)/i;
    let sectionEls = Array.from(
      document.querySelectorAll(
        'header, [role="banner"], main > section, body > section, section, footer, [role="contentinfo"]'
      )
    ).filter((el, i, arr) => arr.indexOf(el) === i && isVisible(el));
    const headerBar = (() => {
      const cands = Array.from(document.querySelectorAll("div, nav")).filter((el) => {
        if (!isVisible(el)) return false;
        const r = el.getBoundingClientRect();
        return (
          r.top + window.scrollY < 140 && r.width >= vw * 0.8 &&
          r.height >= 36 && r.height <= 170 && el.querySelectorAll("a").length >= 3
        );
      });
      cands.sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return ra.top - rb.top || rb.width - ra.width;
      });
      return cands[0] ?? null;
    })();
    const hasHeaderLandmark = sectionEls.some(
      (e) => e.tagName === "HEADER" || e.getAttribute("role") === "banner"
    );
    if (headerBar && !hasHeaderLandmark && !sectionEls.includes(headerBar)) sectionEls.unshift(headerBar);
    if (!sectionEls.some((e) => e.tagName === "FOOTER")) {
      const fcands = Array.from(document.querySelectorAll("div, footer")).filter((el) => {
        if (!isVisible(el)) return false;
        const r = el.getBoundingClientRect();
        return r.width >= vw * 0.8 && r.height >= 80 &&
          copyRe.test(el.textContent || "") && el.querySelectorAll("a").length >= 3;
      });
      const footerBar = fcands[fcands.length - 1];
      if (footerBar && !sectionEls.includes(footerBar)) sectionEls.push(footerBar);
    }
    if (sectionEls.filter((e) => e.tagName === "SECTION").length < 2) {
      const host = document.querySelector("main") ?? document.body;
      if (host) {
        for (const child of Array.from(host.children)) {
          if (!isVisible(child)) continue;
          const r = child.getBoundingClientRect();
          if (r.height > 240 && r.width > 320 && !sectionEls.includes(child)) sectionEls.push(child);
        }
      }
    }
    const withTop = sectionEls
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((s) => s.r.height > 40)
      .sort((a, b) => a.r.top + scrollY - (b.r.top + scrollY));

    // ---- container card tốt nhất + số cột (rút gọn từ scrapeDom) ----
    const bestContainer = (root: Element): Element | null => {
      let best = 0, bestC: Element | null = null, checked = 0;
      for (const c of Array.from(root.querySelectorAll("ul, ol, div, section"))) {
        if (checked++ > 250) break;
        const kids = Array.from(c.children);
        if (kids.length < 3) continue;
        const counts: Record<string, number> = {};
        for (const k of kids) {
          const cls = (k.className?.toString() ?? "").split(/\s+/).slice(0, 2).join(".");
          counts[`${k.tagName}|${cls}`] = (counts[`${k.tagName}|${cls}`] ?? 0) + 1;
        }
        const top = Math.max(0, ...Object.values(counts));
        if (top >= 3 && c.getBoundingClientRect().height / Math.max(1, kids.length) > 60 && top > best) {
          best = top; bestC = c;
        }
      }
      return bestC;
    };
    const colsOf = (el: Element): number => {
      const container = bestContainer(el) ?? el;
      const cs = getComputedStyle(container);
      let cols = 1;
      if (cs.display.includes("grid") && cs.gridTemplateColumns && cs.gridTemplateColumns !== "none") {
        cols = cs.gridTemplateColumns.split(/\s+/).filter(Boolean).length || 1;
      } else if (cs.display.includes("flex")) {
        const kids = Array.from(container.children).filter((k) => k.getBoundingClientRect().width > 0);
        if (kids.length) {
          const firstTop = kids[0].getBoundingClientRect().top;
          cols = kids.filter((k) => Math.abs(k.getBoundingClientRect().top - firstTop) < 8).length || 1;
        }
      }
      return Math.max(1, Math.min(cols, 6));
    };

    return withTop.map((s) => colsOf(s.el));
  });
}
