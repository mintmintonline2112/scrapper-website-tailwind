# Layout System — cấu trúc chuẩn & quy ước CSS

Đây là **nguồn sự thật** cho cách dựng layout: bộ section chuẩn, token, quy ước class.
Code generator (`src/codegen-html.ts` → HTML/CSS, `src/codegen.ts` → Tailwind) sinh ra output
**bám đúng spec này**, nên khi viết FE tay bạn theo cùng quy ước → nhất quán, nhanh, dễ maintain.

Triết lý: **không clone pixel** — đổ content + tokens đã trích vào layout chuẩn. Một skeleton
dễ đoán quan trọng hơn một bản sao y hệt.

- Bản dùng được: [design-system/base.css](design-system/base.css) (vanilla), [design-system/skeleton.html](design-system/skeleton.html) (mẫu đầy đủ section).
- Pipeline trích token: xem [ui-capture-analyzer-workflow.md](ui-capture-analyzer-workflow.md).

---

## 1. Design tokens (hợp đồng CSS variable)

Mọi màu/bo góc/độ rộng đều đi qua biến — đổi 1 chỗ, cả trang theo. Codegen bơm giá trị thật
vào `:root`; viết tay thì dùng default dưới đây.

```css
:root {
  /* màu — trích từ computed CSS của site mẫu, đã gom cụm */
  --color-bg:         #ffffff;  /* nền trang */
  --color-text:       #111827;  /* chữ chính */
  --color-primary:    #2563eb;  /* màu brand (nút, link nhấn) */
  --color-accent:     #f59e0b;  /* màu phụ */
  --color-border:     #e5e7eb;  /* viền, đường kẻ */
  --color-on-primary: #ffffff;  /* chữ trên nền primary (tự chọn để đủ tương phản) */

  /* hình khối */
  --radius:    12px;            /* bo góc chuẩn (card, nút, input) */
  --container: 1200px;          /* bề rộng nội dung tối đa */
  --font: "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}

/* dark mode: chỉ thêm khi site thật hỗ trợ prefers-color-scheme */
[data-theme="dark"] {
  --color-bg: #0b0f19; --color-text: #e5e7eb; --color-border: #1f2937;
  /* primary/accent thường giữ nguyên hoặc sáng hơn 1 nấc */
}
```

### Scale (thang giá trị — không dùng số tuỳ tiện)

| Thang | Giá trị (px) | Dùng cho |
|---|---|---|
| **Spacing** | 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 | padding, gap, margin |
| **Type** | 12 · 14 · 16 · 18 · 20 · 24 · 30 · 36 · 48 · 60 | font-size |
| **Radius** | 4 · 8 · 12 · 16 · full | bo góc |

Quy ước: section padding dọc = **64px** (`py` lớn), gap grid = **24px**, padding card = **24px**.

---

## 2. Layout primitives

| Class | Vai trò | Tóm tắt CSS |
|---|---|---|
| `.container` | Khung nội dung căn giữa | `max-width: var(--container); margin-inline: auto; padding-inline: 24px` |
| `.container.narrow` | Khung hẹp (bài viết, form) | `max-width: 768px` |
| `.section` | Khối dọc 1 màn | `padding-block: 64px` |
| `.grid` | Lưới responsive | cột điều khiển bằng `--cols/--cols-md/--cols-sm` |
| `.center` / `.right` | Căn text | `text-align` |
| `.muted` | Chữ phụ mờ | `opacity: .7` |

### Lưới responsive (1 cơ chế duy nhất)

Mọi grid dùng custom property cho số cột theo breakpoint — codegen đo được bao nhiêu cột thì set bấy nhiêu:

```html
<div class="grid" style="--cols:3; --cols-md:2; --cols-sm:1; --gap:24px"> … </div>
```

```css
.grid { display:grid; gap:var(--gap,24px); grid-template-columns:repeat(var(--cols-sm,1),1fr); }
@media (min-width:640px)  { .grid { grid-template-columns:repeat(var(--cols-md,2),1fr); } }
@media (min-width:1024px) { .grid { grid-template-columns:repeat(var(--cols,3),1fr); } }
```

Breakpoint chuẩn: **mobile < 640 ≤ tablet < 1024 ≤ desktop**.

---

## 3. Bộ section chuẩn

Mỗi vai trò (role) detect được → đúng 1 template. Cột "Slot" = nội dung đổ vào từ capture.

| # | Role | Component | Cấu trúc semantic | Slot nội dung |
|---|---|---|---|---|
| 1 | `header` | **Header** | `header.site-header > .container > nav.nav` | logo, nav links, 1 CTA |
| 2 | `hero` | **Hero** | `section.section > .container > .hero` | h1, `.lead`, `.actions` (1–2 nút), ảnh |
| 3 | `features` | **Features** | `section > .container > h2 + .grid` | heading, N card (ảnh/icon + h3 + text) |
| 4 | `split` | **Split** | `section > .container.split` | text 1 bên, ảnh 1 bên (xen kẽ) |
| 5 | `stats` | **Stats** | `section > .container > .grid` | hàng: số lớn `.stat` + nhãn |
| 6 | `logos` | **LogoCloud** | `section.center > .eyebrow + .logos` | eyebrow + hàng logo |
| 7 | `testimonial` | **Quote** | `section > .grid > figure.card` | blockquote + figcaption (tên) |
| 8 | `pricing` | **Pricing** | `section > .grid > .card(--featured)` | h3 + `.price` + list + nút |
| 9 | `faq` | **FAQ** | `section.narrow > .faq > details` | hỏi/đáp accordion |
| 10 | `cta` | **CTA** | `section > .cta-banner` | heading + 1 nút (nền primary) |
| 11 | `footer` | **Footer** | `footer.site-footer > .container` | cột link + copyright |

### Skeleton HTML từng section (rút gọn)

```html
<!-- 1. Header -->
<header class="site-header">
  <div class="container">
    <nav class="nav">
      <span class="brand">Brand</span>
      <ul class="nav-links"><li><a href="#">Link</a></li>…</ul>
      <div class="nav-actions"><a href="#" class="btn btn--primary">CTA</a></div>
    </nav>
  </div>
</header>

<!-- 2. Hero -->
<section class="section">
  <div class="container">
    <div class="hero center">
      <h1>Headline</h1>
      <p class="lead muted">Subheading.</p>
      <div class="actions">
        <a href="#" class="btn btn--primary">Primary</a>
        <a href="#" class="btn btn--outline">Secondary</a>
      </div>
    </div>
  </div>
</section>

<!-- 3. Features (media card) -->
<section class="section">
  <div class="container">
    <h2 class="center mb">Heading</h2>
    <div class="grid" style="--cols:3;--cols-md:2;--cols-sm:1">
      <article class="card card--media">
        <img class="card-img" src="…" alt="">
        <div class="card-body"><h3>Title</h3><p class="muted">Text.</p></div>
      </article>
      …
    </div>
  </div>
</section>

<!-- 10. CTA -->
<section class="section">
  <div class="container">
    <div class="cta-banner">
      <h2>Ready?</h2>
      <a href="#" class="btn btn--on-primary">Get started</a>
    </div>
  </div>
</section>

<!-- 11. Footer -->
<footer class="site-footer">
  <div class="container">
    <div class="grid" style="--cols:4;--cols-md:2;--cols-sm:2">…cột link…</div>
    <p class="muted">© 2026 Brand.</p>
  </div>
</footer>
```

Bộ đầy đủ chạy được: [design-system/skeleton.html](design-system/skeleton.html).

---

## 4. Component dùng lại

### Button — `.btn`
| Class | Kiểu |
|---|---|
| `.btn--primary` | nền `--color-primary`, chữ `--color-on-primary` |
| `.btn--outline` | viền `--color-border`, nền trong suốt |
| `.btn--link` | chữ `--color-primary`, không nền |
| `.btn--on-primary` | nền trắng/`--color-bg` (đặt trên nền primary) |
| `.btn.full` | full-width (trong card pricing) |

### Card — `.card`
- `.card` — viền + bo góc + padding 24px, hover nhấc nhẹ + đổ bóng.
- `.card--media` — padding 0, ảnh tràn viền trên (`.card-img`, aspect-ratio 16/10, object-fit cover) + `.card-body` padding.
- `.card--featured` — viền primary + bóng (gói nổi bật trong pricing).

---

## 5. Quy ước CSS

- **Đặt tên**: block `.card`, modifier `.card--media`, element `.card-body`. Không lồng selector sâu, không `#id` cho style.
- **Token-first**: màu/bo góc/khoảng cách luôn qua biến `--*`, không hardcode hex/px rời rạc trong component.
- **Mobile-first**: viết style mobile trước, `@media (min-width: …)` nâng lên.
- **Không !important**, không inline style trừ custom property của grid (`--cols…`).
- **1 section = 1 `.section`** bọc `.container`; nền khác → set trên `.section`, không phá container.

---

## 6. Map HTML/CSS → Tailwind (để "convert" xác định)

Cùng một cấu trúc, đổi hệ class. Codegen Tailwind (`src/codegen.ts`) dùng đúng bảng này.

| Vanilla (base.css) | Tailwind |
|---|---|
| `.container` | `max-w-7xl mx-auto px-6` (max-w theo `--container`) |
| `.section` | `py-16` |
| `.grid` (3 cột) | `grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` |
| `.card` | `rounded-xl border border-[var(--color-border)] p-6` |
| `.card--media` + `.card-img` | `overflow-hidden rounded-xl border` + `h-44 w-full object-cover` |
| `.btn--primary` | `rounded-lg bg-[var(--color-primary)] text-white px-6 py-3 font-semibold` |
| `.btn--outline` | `rounded-lg border border-[var(--color-border)] px-6 py-3 font-semibold` |
| màu | giữ `var(--color-*)` (đã khai trong globals.css) hoặc `tailwindHints` (vd `blue-600`) |
| `--color-text` mờ | `opacity-70` |

Quy tắc: **cấu trúc DOM giữ nguyên 1-1**, chỉ thay thuộc tính class → convert không lệch layout.
