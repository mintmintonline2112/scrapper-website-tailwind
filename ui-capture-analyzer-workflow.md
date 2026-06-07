# UI Capture & Analyzer Tool – Workflow triển khai

## 1. Mục tiêu của tool

Tool này dùng để hỗ trợ quá trình rebuild giao diện website theo hướng sạch, có kiểm soát và dễ maintain.

Mục tiêu chính không phải là clone nguyên website, mà là:

- **Scrape DOM + computed CSS từ browser thật** để lấy số liệu thiết kế chính xác (màu hex, font, spacing, radius, shadow) — đây là dữ liệu cốt lõi giúp AI rebuild đúng thay vì đoán mò.
- Chụp screenshot website mẫu theo nhiều kích thước màn hình (phụ trợ — cho mắt người và AI vision).
- Lưu lại HTML snapshot để tham khảo cấu trúc trang.
- Gom cụm (cluster) dữ liệu style thô thành design tokens gọn gàng (palette ~8 màu, spacing scale ~6 mức).
- Tạo rebuild brief để dùng làm đầu vào cho việc dựng lại giao diện bằng Next.js + Tailwind.
- Hỗ trợ tạo component structure để dev/code assistant rebuild nhanh hơn.

Định vị đúng của tool:

```txt
Not a website cloner.
It is a DOM/CSS reference scraper + rebuild assistant.
Computed CSS is the source of truth. Screenshots are a visual aid.
```

Triết lý kiến trúc (quan trọng):

```txt
~70% công sức: computed-CSS scraper + gom cụm token
~30% công sức: screenshot (reference cho mắt người + đầu vào AI vision)
```

Vì tool đã chạy Playwright (browser thật), việc lấy computed style gần như miễn phí —
browser đã resolve sẵn toàn bộ CSS cascade. Không cần parse file CSS, không cần đoán từ ảnh.

---

## 2. Khi nào nên dùng tool này?

Nên dùng khi:

- Cần tham khảo layout từ nhiều website.
- Cần rebuild nhiều landing page hoặc nhiều page trong cùng một website.
- Cần chụp đủ desktop, tablet, mobile.
- Cần lưu trữ design reference có hệ thống.
- Cần giảm việc đoán mò khi dùng AI generate Tailwind code.
- Cần xây workflow nội bộ cho team dev/marketing/design.

Không cần dùng khi:

- Chỉ làm 1 landing page rất đơn giản.
- Chỉ cần demo nhanh.
- Không cần phân tích responsive.
- Chấp nhận việc AI nhìn screenshot và generate code tương đối.

---

## 3. Output mong muốn

Với mỗi URL, tool sẽ tạo một folder output như sau:

```txt
output/
  example-com/
    screenshots/
      desktop-full.png
      desktop-above-fold.png
      tablet-full.png
      tablet-above-fold.png
      mobile-full.png
      mobile-above-fold.png

    snapshots/
      page.html
      metadata.json

    analysis/
      layout-map.json
      design-tokens.json
      components.json
      rebuild-brief.md
```

---

## 4. Workflow tổng thể

```txt
User nhập URL
        ↓
Playwright mở website bằng browser thật
        ↓
Chờ trang load xong (networkidle)
        ↓
Auto scroll để lazy-load hình ảnh + DOM
        ↓
Scrape DOM: layout, section, heading, button, image (page.$$eval)
        ↓
Scrape computed CSS từ element chính (getComputedStyle)  ← dữ liệu cốt lõi
        ↓
Gom cụm style thô → design tokens gọn (palette, spacing scale, radius scale)
        ↓
Chụp screenshot desktop / tablet / mobile (phụ trợ)
        ↓
Lưu HTML snapshot và metadata
        ↓
Sinh rebuild brief (kết hợp tokens + structure + screenshot)
        ↓
Dùng brief để rebuild bằng Next.js + Tailwind
```

---

## 5. Tech stack đề xuất

```txt
Node.js
TypeScript
Playwright          ← scrape DOM + computed CSS + screenshot (lõi)
Sharp
fs-extra
slugify
Next.js + Tailwind cho dashboard ở phase sau
```

Vai trò từng phần:

| Công nghệ | Vai trò |
|---|---|
| Playwright | Mở website thật; scrape DOM (`page.$$eval`) + computed CSS (`getComputedStyle` qua `page.evaluate`); chụp screenshot |
| TypeScript | Code rõ ràng, dễ maintain |
| Sharp | Xử lý ảnh, resize/crop nếu cần |
| fs-extra | Tạo folder, ghi file JSON/MD |
| slugify | Tạo tên folder theo domain |
| Next.js | Làm dashboard nội bộ ở phase sau |
| Tailwind | UI cho dashboard |

> **Đã loại Cheerio:** vì đã có browser thật, dùng `page.$$eval` thay cho parse HTML tĩnh —
> thấy được cả SPA, DOM sau khi JS chạy, và truy cập trực tiếp computed style. Cheerio chỉ
> đọc HTML tĩnh nên không thấy style và mất nội dung render bằng JS.
>
> **Đã loại node-vibrant/color-thief:** không cần extract màu *từ ảnh* nữa, vì màu lấy
> trực tiếp từ `getComputedStyle` đã chính xác (hex thật), không phải màu xấp xỉ từ pixel.

---

## 6. Roadmap triển khai

### Phase 1 – CLI Capture Tool

Mục tiêu: nhập URL và tự động chụp screenshot + lưu HTML.

Tính năng:

- Nhập URL từ command line.
- Tạo folder output theo domain.
- Chụp desktop, tablet, mobile.
- Chụp full-page và above-the-fold.
- Lưu HTML snapshot.
- Lưu metadata cơ bản.

Output:

```txt
screenshots/
snapshots/page.html
snapshots/metadata.json
```

---

### Phase 2 – DOM Scraper (structure)

Mục tiêu: bóc tách cấu trúc trang **từ DOM live trong browser** (không dùng Cheerio).

Tính năng:

- Dùng `page.$$eval` để extract heading: h1, h2, h3.
- Extract button/CTA (kèm text + vai trò).
- Extract image (src + alt + kích thước render thật).
- Extract section/header/footer/main + thứ tự xuất hiện.
- Xuất layout-map.json.

Output:

```txt
analysis/layout-map.json
```

---

### Phase 3 – Computed CSS Scraper + Token Clustering (LÕI)

Mục tiêu: lấy số liệu style chính xác từ `getComputedStyle` rồi **gom cụm** thành tokens gọn.
Đây là phần tạo ra giá trị thật của tool.

Tính năng:

- Scrape computed style từ các element chính (xem mục 12).
- Thu thập màu thật (hex/rgb), font, font-size, spacing, radius, shadow, layout.
- **Gom cụm (cluster) dữ liệu thô** → tránh "nổ" hàng trăm giá trị rời rạc:
  - Màu: gom về palette ~8 màu chủ đạo (theo tần suất xuất hiện + độ tương phản).
  - Spacing: gom px về scale ~6 mức (4/8/12/16/24/32...).
  - Font-size: gom về type scale ~5–7 mức.
  - Radius/shadow: gom về vài biến thể phổ biến nhất.
- Map giá trị về **Tailwind token gần nhất** (vd: `#3b82f6` → `blue-500`, `16px` → `p-4`).

Output:

```txt
analysis/design-tokens.json
```

---

### Phase 4 – AI UI Brief Generator

Mục tiêu: biến dữ liệu capture thành prompt/brief tốt cho AI hoặc code assistant.

Tính năng:

- Tạo component tree.
- Đề xuất component breakdown.
- Đề xuất Tailwind style direction.
- Tạo prompt để generate Next.js + Tailwind page.

Output:

```txt
analysis/components.json
analysis/ai-prompt.md
```

---

### Phase 5 – Next.js Dashboard

Mục tiêu: tạo giao diện nội bộ để dùng tool dễ hơn.

Tính năng:

- Input URL.
- Button Capture.
- Preview screenshot.
- Xem layout-map.
- Xem rebuild brief.
- Download output folder/ZIP.
- Generate starter component nếu cần.

Cấu trúc app:

```txt
app/
  page.tsx
  api/
    capture/
      route.ts

components/
  UrlInput.tsx
  ScreenshotPreview.tsx
  AnalysisPanel.tsx
  ExportButton.tsx

lib/
  capture.ts
  analyze.ts
  report.ts
  generate-code.ts
```

---

## 7. Cấu trúc project CLI ban đầu

```txt
ui-capture-tool/
  package.json
  tsconfig.json

  src/
    index.ts
    capture.ts        # screenshot + HTML snapshot (phụ trợ)
    scrape-dom.ts     # page.$$eval → layout-map.json
    scrape-css.ts     # getComputedStyle → design-tokens.raw.json
    cluster-tokens.ts # gom cụm → design-tokens.json (lõi)
    report.ts         # sinh rebuild-brief.md
    config.ts

  output/
    example-com/
      screenshots/
      snapshots/
      analysis/
```

---

## 8. Lệnh cài đặt ban đầu

```bash
npm init -y
npm install playwright sharp fs-extra slugify
npm install -D typescript tsx @types/node @types/fs-extra
npx playwright install chromium
```

Tạo file `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

Thêm script vào `package.json`:

```json
{
  "scripts": {
    "capture": "tsx src/index.ts"
  }
}
```

Chạy tool:

```bash
npm run capture -- https://example.com
```

---

## 9. Logic capture screenshot

Các viewport mặc định:

```ts
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];
```

Với mỗi viewport, tool cần:

1. Set viewport size.
2. Open URL.
3. Wait until network idle.
4. Auto scroll để lazy-load content.
5. Scroll về đầu trang.
6. Chụp full-page screenshot.
7. Chụp above-the-fold screenshot.

Output:

```txt
desktop-full.png
desktop-above-fold.png
tablet-full.png
tablet-above-fold.png
mobile-full.png
mobile-above-fold.png
```

---

## 10. Logic HTML snapshot

Sau khi trang load xong, lưu:

```txt
snapshots/page.html
snapshots/metadata.json
```

Metadata nên gồm:

```json
{
  "title": "Page title",
  "description": "Meta description",
  "url": "https://example.com",
  "bodyHeight": 5000,
  "bodyWidth": 1440
}
```

---

## 11. Logic scrape DOM structure

Dùng Playwright `page.$$eval` (DOM live, không dùng Cheerio) để extract:

```txt
- h1, h2, h3
- button
- a có vẻ là CTA
- img (kèm kích thước render thật từ getBoundingClientRect)
- section
- header
- footer
- main
```

Ví dụ:

```ts
const headings = await page.$$eval("h1, h2, h3", els =>
  els.map(el => ({ tag: el.tagName.toLowerCase(), text: el.textContent?.trim() }))
);
```

Output `layout-map.json`:

```json
{
  "headings": [],
  "buttons": [],
  "images": [],
  "sections": []
}
```

---

## 12. Logic scrape computed styles (LÕI của tool)

Dùng Playwright `page.evaluate()` + `getComputedStyle()` để lấy style **đã resolve** từ browser thật.
Đây là phần quan trọng nhất — màu/spacing/font lấy ở đây là số liệu chính xác, không phải đoán.

Nên lấy từ các element chính:

```txt
section
header
footer
main
button
a
h1
h2
h3
.card-like elements nếu detect được
```

Các style nên lưu:

```txt
fontFamily
fontSize
fontWeight
lineHeight
color
backgroundColor
borderTopColor + borderTopWidth   (màu border thật)
padding (+ paddingBottom cho section)
display
gap
gridTemplateColumns
borderRadius
boxShadow
maxWidth
width
height
```

Lưu ý SPA / CSS-in-JS:

```txt
- Phải waitForLoadState("networkidle") + auto-scroll trước khi đọc DOM,
  nếu không SPA chưa render đủ element.
- Với styled-components / Tailwind JIT, class name là rác (vd "css-1x2y3z").
  → KHÔNG cố đọc class name gốc. Luôn đo computed style — nó vẫn đúng tuyệt đối.
```

Output thô (trước khi gom cụm) `design-tokens.raw.json`:

```json
{
  "colors": [],
  "fonts": [],
  "spacing": [],
  "radius": [],
  "shadows": [],
  "layout": []
}
```

---

## 12b. Logic gom cụm token (clustering) – BẮT BUỘC

Một trang thật có thể trả về hàng trăm giá trị màu/spacing rời rạc. Nếu đổ thẳng vào
`design-tokens.json` thì file thành rác, AI không dùng được. Phải gom cụm lại thành scale gọn.

Quy tắc gom cụm:

```txt
- Màu:      đếm tần suất (trọng số ~√diện tích) → gom theo khoảng cách redmean → ~8 màu.
            background = bg sáng/đậm trọng số cao; text = màu chữ tương phản;
            primary/accent = brand từ CTA xếp theo (trọng số × độ bão hoà);
            border = màu border THẬT (đọc border-color, không đoán từ bg).
- Spacing:  CHỈ padding + gap (bỏ margin vì là offset layout, gây nhiễu).
            Làm tròn về scale chuẩn (4/8/12/16/24/32/48/64), giữ ~6 mức.
- Section padding: đo padding dọc của riêng <section>/container lớn (pool riêng),
            KHÔNG lấy mức lớn nhất của scale chung (dễ ra py quá chật).
- Container: lấy max-width của container BỊ GIỚI HẠN và RỘNG NHẤT (≈ container chính),
            không phải max-width phổ biến nhất (dễ trúng container con hẹp).
- Font-size: gom về type scale ~5–7 mức (vd 12 / 14 / 16 / 20 / 24 / 32 / 48).
- Radius:   gom về vài biến thể (vd 0 / 4 / 8 / 16 / full).
- Shadow:   giữ 2–3 biến thể shadow phổ biến nhất.
```

> Hiệu năng: `normColor` (chuẩn hoá màu qua canvas `getImageData`) được **memoize** vì giá
> trị màu lặp nhiều; số element quét bị **cap ~5000** để tránh phình trên SPA cực lớn.

Map sang Tailwind token gần nhất để brief dùng được ngay:

```txt
#3b82f6  → blue-500
16px     → p-4 / gap-4 / m-4
24px     → p-6
8px      → rounded-lg
1.5rem   → text-2xl (tùy scale)
```

Output cuối `design-tokens.json`:

```json
{
  "palette": {
    "background": "#ffffff",
    "text": "#111827",
    "primary": "#3b82f6",
    "accent": "#f59e0b",
    "border": "#e5e7eb"
  },
  "spacingScale": [4, 8, 16, 24, 32, 48],
  "typeScale": [14, 16, 20, 24, 32, 48],
  "radiusScale": [4, 8, 16],
  "shadows": ["0 1px 2px rgba(0,0,0,.05)", "0 10px 15px rgba(0,0,0,.1)"],
  "fonts": ["Inter", "system-ui"],
  "tailwindHints": {
    "primary": "blue-500",
    "containerMaxWidth": "max-w-7xl",
    "sectionPadding": "py-16 px-6"
  }
}
```

---

## 13. Logic generate rebuild brief

File `rebuild-brief.md` nên gồm:

```txt
# Website Rebuild Brief

## Page Summary
- URL
- Title
- Description
- Viewports captured

## Page Structure
- Header
- Hero
- Section 1
- Section 2
- CTA
- Footer

## Design Direction
- Visual tone
- Color palette
- Typography
- Spacing
- Card/button style

## Component Breakdown
- Header
- HeroSection
- FeatureSection
- ProductCard
- CTASection
- Footer

## Tailwind Rebuild Notes
- max-width
- padding
- grid columns
- button classes
- section spacing

## Legal / Usage Note
Use as reference only. Rebuild with original brand assets, copy, images, and design adjustments.
```

---

## 14. Prompt mẫu để đưa cho AI generate Next.js + Tailwind

Sau khi có screenshot + brief, dùng prompt dạng này:

```txt
You are a senior frontend engineer.

Rebuild a new original landing page using Next.js App Router and Tailwind CSS.
Use the attached screenshots and rebuild brief as visual/layout reference only.
Do not copy original brand assets, text, or proprietary design exactly.

Requirements:
- Use semantic HTML.
- Use reusable React components.
- Use Tailwind CSS only.
- Make it responsive for desktop, tablet, and mobile.
- Use placeholder content and images.
- Keep the layout clean and maintainable.
- Create components: Header, HeroSection, FeatureSection, CTASection, Footer.

Output:
- app/page.tsx
- components/Header.tsx
- components/HeroSection.tsx
- components/FeatureSection.tsx
- components/CTASection.tsx
- components/Footer.tsx
```

---

## 15. Quy tắc pháp lý và đạo đức khi dùng tool

Không nên:

- Copy nguyên source code.
- Copy nguyên hình ảnh, icon, logo, text, animation độc quyền.
- Clone giao diện y chang để public hoặc commercial.
- Bypass login/paywall/rate limit.
- Crawl dữ liệu cá nhân.

Nên:

- Dùng website mẫu làm visual reference.
- Rebuild lại bằng branding, nội dung, hình ảnh và component riêng.
- Thay đổi layout đủ để tạo bản thiết kế độc lập.
- Kiểm tra Terms of Service nếu dùng ở quy mô lớn.
- Chỉ capture các trang public.

---

## 16. Checklist triển khai MVP

### Setup

- [ ] Tạo project Node.js.
- [ ] Cài TypeScript.
- [ ] Cài Playwright (`npx playwright install chromium`).
- [ ] Cài fs-extra + slugify.
- [ ] Tạo folder `src`.

### Capture

- [ ] Nhận URL từ command line.
- [ ] Tạo folder output theo domain.
- [ ] Mở browser headless.
- [ ] Chụp desktop full-page.
- [ ] Chụp desktop above-fold.
- [ ] Chụp tablet full-page.
- [ ] Chụp tablet above-fold.
- [ ] Chụp mobile full-page.
- [ ] Chụp mobile above-fold.
- [ ] Lưu HTML snapshot.
- [ ] Lưu metadata.

### Scrape DOM (structure)

- [ ] Scrape DOM bằng `page.$$eval` (không Cheerio).
- [ ] Extract headings.
- [ ] Extract buttons/CTA.
- [ ] Extract images.
- [ ] Extract sections.
- [ ] Lưu layout-map.json.

### Scrape CSS + Cluster (lõi)

- [ ] Scrape computed style từ element chính (`getComputedStyle`).
- [ ] Lưu design-tokens.raw.json.
- [ ] Gom cụm màu → palette ~8 màu.
- [ ] Gom cụm spacing → scale ~6 mức.
- [ ] Gom cụm font-size → type scale.
- [ ] Map sang Tailwind token gần nhất.
- [ ] Lưu design-tokens.json.

### Report

- [ ] Generate rebuild-brief.md (kết hợp tokens + structure + screenshot).
- [ ] Ghi page summary.
- [ ] Ghi component breakdown.
- [ ] Ghi Tailwind rebuild notes.
- [ ] Ghi usage/legal note.

### Next Phase

- [ ] Generate AI prompt.
- [ ] Generate component-tree.json.
- [ ] Làm dashboard bằng Next.js.

---

## 17. Kết luận định hướng

Cách làm nên đi theo thứ tự:

```txt
CLI trước → DOM/CSS scraper + cluster token → AI brief generator → Dashboard → Code generator
```

Không nên bắt đầu bằng dashboard hoặc auto code generator ngay, vì scope sẽ phình nhanh và khó kiểm soát.

MVP tốt nhất là:

```txt
Input URL
→ mở browser thật, chờ networkidle + auto-scroll
→ scrape DOM structure (layout-map)
→ scrape computed CSS + gom cụm → design-tokens
→ capture 3 viewport (phụ trợ) + save HTML/metadata
→ generate rebuild brief
```

Điểm khác biệt cốt lõi so với bản cũ: **computed CSS là nguồn sự thật, screenshot chỉ là phụ trợ.**
Giá trị của tool nằm ở `design-tokens.json` đã gom cụm — đó là thứ giúp AI rebuild đúng số liệu
thay vì đoán từ ảnh.

Sau khi dùng thực tế 5–10 lần, nếu tool thật sự tiết kiệm thời gian, lúc đó mới nâng cấp lên dashboard và AI code generation.
