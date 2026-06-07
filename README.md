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
```

Output ghi vào `output/<domain-slug>/`.

## Pipeline (Phase 1–5 đã có)

| Phase | File | Việc |
|---|---|---|
| 1 | `src/capture.ts` | Screenshot desktop/tablet/mobile (full + above-fold), HTML snapshot, metadata |
| 2 | `src/scrape-dom.ts` | Bóc cấu trúc từ DOM live (`page.evaluate`): heading, CTA, image, section → `layout-map.json` |
| 3a | `src/scrape-css.ts` | Scrape computed style + màu brand từ CTA/link → `design-tokens.raw.json` |
| 3b | `src/cluster-tokens.ts` | Gom cụm màu/spacing/font (brand = weight × saturation) → `design-tokens.json` |
| — | `src/report.ts` | Sinh `rebuild-brief.md` |
| 4 | `src/generate.ts` | Suy ra component tree (theo section role + card-grid) → `components.json` + `ai-prompt.md` |
| 6 | `src/codegen.ts` | Sinh starter Next.js + Tailwind THẬT → `rebuild/` (page.tsx + components + globals + token theme) |
| — | `src/run.ts` | `runCapture()` orchestrate Phase 1–6, dùng chung CLI + dashboard |
| 5 | `dashboard/` | Next.js dashboard: nhập URL, capture, preview, tokens, code, download ZIP |

### Phase 6 — code generator

Sinh ra thư mục `output/<slug>/rebuild/` chạy được:
- `app/page.tsx` compose toàn bộ component
- `components/<Name>.tsx` (Header/Hero/Feature/CTA/Content/Footer) với class Tailwind + màu brand qua CSS var
- `app/globals.css` (CSS variables palette) + `tailwind.tokens.cjs` (theme để trộn vào config)
- Nội dung placeholder lấy từ heading/CTA đã capture; grid card dùng số card detect được.

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
- Preview screenshot 3 viewport, palette swatch, bảng tokens, component breakdown.
- **Xem code sinh ra** trong `rebuild/` ngay trên UI + nút **Copy AI prompt**.
- Tải `rebuild-brief.md` / `design-tokens.json` / `ai-prompt.md` / ZIP cả folder.

## Output mỗi URL

```txt
output/<slug>/
  screenshots/   desktop|tablet|mobile -full.png / -above-fold.png
  snapshots/     page.html, metadata.json
  analysis/      layout-map.json, design-tokens.raw.json, design-tokens.json,
                 rebuild-brief.md, components.json, ai-prompt.md
  rebuild/       app/page.tsx, app/globals.css, components/*.tsx,
                 tailwind.tokens.cjs, README.md   (Phase 6 — code sinh ra)
```

## Ghi chú kỹ thuật

- **Màu**: chuẩn hoá mọi định dạng (rgb/hex/`lab()`/`oklab()`/`oklch()`/named) về rgb bằng canvas của browser, rồi gom cụm theo khoảng cách "redmean" có trọng số diện tích.
- **Spacing/type/radius**: snap về scale chuẩn (4/8/16/24/32… ; 12/14/16/20/24…) và map sang class Tailwind gần nhất.
- **SPA**: chờ `networkidle` (có timeout mềm) + auto-scroll để lazy-load trước khi đọc DOM.
- **CSS-in-JS**: không đọc class name gốc, chỉ đo computed style nên luôn đúng.

## Pháp lý

Chỉ dùng làm visual/layout reference. Rebuild bằng branding, nội dung, hình ảnh riêng.
Không copy source code, logo, text, design độc quyền để public/commercial.
