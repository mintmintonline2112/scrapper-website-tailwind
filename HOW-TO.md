# HOW-TO — rebuild một trang bằng tool này

Quy trình 7 bước khi muốn dựng lại (rebuild) giao diện một trang.
Tool là **reference + rebuild**, KHÔNG clone nguyên si — chỉ dùng làm tham chiếu layout/tokens,
rồi dựng lại bằng branding/nội dung/ảnh riêng (xem mục pháp lý trong
[ui-capture-analyzer-workflow.md](ui-capture-analyzer-workflow.md)).

Tóm gọn 1 dòng:
```
capture → lấy tokens + structure → dựng khung bằng design-system → đổ content thật → tự thêm phần động + branding
```

---

## Bước 0 — Cài (lần đầu)
```bash
npm install
npx playwright install chromium
```

## Bước 1 — Capture trang mẫu
```bash
npm run capture -- https://trang-can-rebuild.vn
```
- Nhiều trang một lượt: `npm run capture -- a.com b.com c.com`
- Từ file danh sách: `npm run capture -- urls.txt` (mỗi dòng 1 URL, `#` = comment)
- Trực quan hơn (log realtime, lịch sử, preview, tải ZIP):
  ```bash
  cd dashboard && npm run dev   # http://localhost:3030
  ```

→ Mọi thứ đổ vào `output/<slug>/`.

## Bước 2 — Xem & đánh giá
Mở theo thứ tự:
1. `output/<slug>/screenshots/desktop-full.png` — trang gốc tổng thể.
2. `output/<slug>/rebuild-html/index.html` — mở bằng trình duyệt, xem bản rebuild tự sinh.
3. `output/<slug>/analysis/rebuild-brief.md` — tóm tắt màu/font/spacing/section.

Tự hỏi: *cấu trúc + tokens đúng chưa? tool bỏ phần nào (hero tương tác, map, search)?*

## Bước 3 — Lấy "nguyên liệu" tin cậy
Phần tool làm chuẩn, dùng thẳng:
| File | Dùng để |
|---|---|
| `analysis/design-tokens.json` | màu / font / spacing / radius → đổ vào `:root` |
| `analysis/components.json` | danh sách + thứ tự section (Header → … → Footer) |
| `analysis/layout-map.json` | heading, CTA, ảnh, nội dung card thật |
| `analysis/accessibility.md` | điểm a11y + chỗ cần sửa (contrast, alt, heading) |

## Bước 4 — Dựng khung theo design system (tiết kiệm thời gian nhất)
1. Copy [design-system/base.css](design-system/base.css) vào dự án.
2. Mở [design-system/skeleton.html](design-system/skeleton.html), copy **đúng các section có trong `components.json`** (bỏ cái thừa).
3. Dán tokens (Bước 3) vào `:root` của base.css → cả trang đổi theme theo brand.
4. Đổ nội dung thật (heading/CTA/ảnh từ `layout-map.json`) vào các slot.

Quy ước class/structure: [LAYOUT-SYSTEM.md](LAYOUT-SYSTEM.md).

## Bước 5 — Chọn 1 đường hoàn thiện
| Đường | Khi nào | Làm gì |
|---|---|---|
| **A. Tay + design system** | Muốn kiểm soát, code sạch | Làm Bước 4 rồi viết FE theo `base.css` |
| **B. Dùng code sinh sẵn** | Muốn nhanh | Lấy `output/<slug>/rebuild-html/` (HTML/CSS) hoặc `rebuild/` (Next.js + Tailwind) làm điểm xuất phát, sửa lại |
| **C. Qua AI** | Muốn polished | Đưa `analysis/ai-prompt.md` + vài screenshot vào Claude/v0 → sinh Next.js, rồi ghép |

## Bước 6 — Phần tool KHÔNG làm được (tự thêm)
- **Hero tương tác / map / search** — viết tay, đây là app động.
- **Branding riêng** — logo, ảnh, copy của *bạn* (đừng bê nguyên của trang gốc).
- **Animation, state, data** — tool chỉ chụp layout tĩnh.

## Bước 7 — HTML/CSS → Tailwind (nếu cần)
Giữ nguyên DOM 1-1, chỉ đổi class theo bảng map ở mục 6 của [LAYOUT-SYSTEM.md](LAYOUT-SYSTEM.md)
(vd `.card` → `rounded-xl border border-[var(--color-border)] p-6`).

---

## Cây output mỗi lần capture
```txt
output/<slug>/
  screenshots/   desktop|tablet|mobile -full.png / -above-fold.png
  snapshots/     page.html, metadata.json
  analysis/      layout-map.json, design-tokens.json, design-tokens.raw.json,
                 rebuild-brief.md, components.json, ai-prompt.md, accessibility.{json,md}
  rebuild/       Next.js + Tailwind (app/, components/, tailwind.config.ts, preview.html)
  rebuild-html/  vanilla HTML/CSS/JS (index.html, styles.css, script.js, assets/)
```

## Tài liệu liên quan
- [LAYOUT-SYSTEM.md](LAYOUT-SYSTEM.md) — cấu trúc layout chuẩn + quy ước CSS + map Tailwind
- [design-system/base.css](design-system/base.css) — stylesheet dùng lại
- [design-system/skeleton.html](design-system/skeleton.html) — khung mẫu đầy đủ section
- [ui-capture-analyzer-workflow.md](ui-capture-analyzer-workflow.md) — thiết kế pipeline + pháp lý
- [README.md](README.md) — tổng quan tool
