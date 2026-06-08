# UI Capture & Analyzer Tool

DOM/CSS reference scraper + screenshot capture cho việc rebuild UI bằng Next.js + Tailwind.
**Computed CSS là nguồn sự thật, screenshot là tham chiếu cho mắt người.** Đây không phải tool clone website.

> Thiết kế chi tiết: xem [ui-capture-analyzer-workflow.md](ui-capture-analyzer-workflow.md).

## Cài đặt

```bash
npm install
npx playwright install chromium
```

## Dùng

```bash
npm run capture -- https://example.com

# Batch: nhiều URL trong một lần (tái dùng 1 browser)
npm run capture -- stripe.com linear.app vercel.com

# Batch từ file (mỗi dòng 1 URL, '#' = comment)
npm run capture -- urls.txt
```

Output ghi vào `output/<domain-slug>/`. Batch còn sinh `output/index.md` + `index.json` tổng hợp.

## Test

```bash
npm test   # unit test cho color math, scale snapping, slug (node:test)
```

## Pipeline (Phase 1–5 đã có)

| Phase | File | Việc |
|---|---|---|
| 1 | `src/capture.ts` | Screenshot desktop/tablet/mobile (full + above-fold), HTML snapshot, metadata. **Tự tắt cookie/consent overlay trước khi chụp/đo.** |
| 2 | `src/scrape-dom.ts` | Bóc cấu trúc + **nội dung thật từng section** (heading/subtext/CTA/card) + **đo layout** (cột/gap/canh lề/padding) → `layout-map.json` |
| 3a | `src/scrape-css.ts` | Scrape computed style + màu brand từ CTA/link → `design-tokens.raw.json`. Có `scrapeColorScheme()` đo lại màu ở **dark mode**. |
| 3b | `src/cluster-tokens.ts` | Gom cụm màu/spacing/font (brand = weight × saturation) → `design-tokens.json` (+ `darkPalette` nếu site có dark) |
| 7 | `src/audit.ts` | **Audit accessibility** trang gốc (contrast WCAG, alt, heading order) → `accessibility.json` + `.md` |
| — | `src/report.ts` | Sinh `rebuild-brief.md` |
| 4 | `src/generate.ts` | Suy ra component tree (taxonomy: hero/features/**pricing/testimonial/logos/faq/stats**/cta…) → `components.json` + `ai-prompt.md` |
| 6 | `src/codegen.ts` | Sinh starter Next.js + Tailwind THẬT → `rebuild/` (page.tsx + components + globals + `tailwind.config.ts`) |
| 6b | `src/codegen-html.ts` | Sinh bản **vanilla HTML + CSS + JS** tự chạy → `rebuild-html/` (index.html + styles.css + script.js + assets) |
| — | `src/run.ts` | `runCapture()` orchestrate Phase 1–7, dùng chung CLI + dashboard |
| 5 | `dashboard/` | Next.js dashboard: nhập URL, capture, preview, tokens, a11y, code, download ZIP |

### Phase 6 — code generator (faithful + dễ sửa)

Sinh ra thư mục `output/<slug>/rebuild/` chạy được:
- `app/page.tsx` compose toàn bộ component theo đúng thứ tự section + `app/layout.tsx` (root layout, tự nhúng Google Font nếu nhận ra).
- `components/<Name>.tsx` — **inline nội dung THẬT đã capture** (heading/subtext/CTA), dùng **layout đo được** (số cột/gap/canh lề). Số cột là **responsive THẬT** (đo lại ở 768px/390px), không đoán. Danh sách card/plan/quote tách thành **mảng `const` ngay đầu file** để thêm/bớt/sửa không phải đụng JSX.
- **Ảnh thật** tải về `public/images/` đúng kích thước đã đo (hero + section), tham chiếu trong component.
- Màu chữ trên nền brand chọn đen/trắng theo **tương phản WCAG** (`--color-on-primary`).
- `app/globals.css` (CSS variables, kèm block `.dark` nếu site có dark mode) + `tailwind.config.ts` drop-in (`darkMode:"class"` khi có dark).
- `preview.html` — **xem ngay không cần dựng app** (React UMD + Tailwind CDN, tái dùng nguyên code component).

## Dashboard (Phase 5 + polish)

```bash
cd dashboard
npm install
npm run dev      # http://localhost:3030
```

Dashboard gọi lại CLI qua child_process (không bundle Playwright vào Next), đọc output từ
`output/<slug>/`. Tính năng:
- **Streaming log** realtime khi capture (NDJSON: `/api/capture-stream`).
- **Lịch sử capture** (sidebar) — bấm để load lại lần cũ không cần chạy lại (`/api/result`).
- Preview screenshot 3 viewport, palette swatch (+ **dark palette**), bảng tokens, component breakdown.
- **Accessibility score** + contrast/alt/heading của trang gốc.
- **Live preview** — render trang rebuild ngay trong iframe, chọn **React (Next)** hoặc **HTML (vanilla)**, toggle dark + đổi viewport.
- **✨ Sinh trang bằng Claude.ai** — 1 nút copy `ai-prompt.md` rồi mở Claude.ai để dán; dùng gói chat sẵn có, **không cần API key, không tốn phí**.
- **Xem code sinh ra** trong `rebuild/` ngay trên UI + nút **Copy AI prompt**.
- Tải `rebuild-brief.md` / `design-tokens.json` / `ai-prompt.md` / `accessibility.md` / ZIP cả folder.

## Output mỗi URL

```txt
output/<slug>/
  screenshots/   desktop|tablet|mobile -full.png / -above-fold.png
  snapshots/     page.html, metadata.json
  analysis/      layout-map.json, design-tokens.raw.json, design-tokens.json,
                 rebuild-brief.md, components.json, ai-prompt.md,
                 accessibility.json, accessibility.md
  rebuild/       app/page.tsx, app/layout.tsx, app/globals.css, components/*.tsx,
                 public/images/*, tailwind.config.ts, preview.html, README.md
  rebuild-html/  index.html, styles.css, script.js, assets/*   (bản vanilla tự chạy)
```
Batch nhiều URL còn sinh `output/index.md` + `index.json`.

## Ghi chú kỹ thuật

- **Màu**: chuẩn hoá mọi định dạng (rgb/hex/`lab()`/`oklab()`/`oklch()`/named) về rgb bằng canvas của browser, rồi gom cụm theo khoảng cách "redmean" có trọng số diện tích.
- **Spacing/type/radius**: snap về scale chuẩn (4/8/16/24/32… ; 12/14/16/20/24…) và map sang class Tailwind gần nhất.
- **SPA**: chờ `networkidle` (có timeout mềm) + auto-scroll để lazy-load trước khi đọc DOM.
- **CSS-in-JS**: không đọc class name gốc, chỉ đo computed style nên luôn đúng.

## Pháp lý

Chỉ dùng làm visual/layout reference. Rebuild bằng branding, nội dung, hình ảnh riêng.
Không copy source code, logo, text, design độc quyền để public/commercial.
