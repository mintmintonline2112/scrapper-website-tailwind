import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseColor,
  hexToRgb,
  toHex,
  colorDist,
  luminance,
  saturation,
  contrastRatio,
  readableOn,
} from "./color-utils.js";
import { clusterScale, nearestTailwind } from "./cluster-tokens.js";
import { slugFromUrl } from "./run.js";

// ---------- color parsing ----------

test("parseColor đọc rgb/rgba, loại màu trong suốt", () => {
  assert.deepEqual(parseColor("rgb(10, 20, 30)"), { r: 10, g: 20, b: 30 });
  assert.deepEqual(parseColor("rgba(255, 0, 0, 1)"), { r: 255, g: 0, b: 0 });
  assert.equal(parseColor("rgba(0, 0, 0, 0.05)"), null); // gần trong suốt
  assert.equal(parseColor("not a color"), null);
});

test("hexToRgb ↔ toHex roundtrip (3 & 6 ký tự)", () => {
  assert.deepEqual(hexToRgb("#3b82f6"), { r: 59, g: 130, b: 246 });
  assert.deepEqual(hexToRgb("fff"), { r: 255, g: 255, b: 255 });
  assert.equal(toHex({ r: 59, g: 130, b: 246 }), "#3b82f6");
  assert.equal(toHex({ r: 300, g: -5, b: 128 }), "#ff0080"); // clamp
  assert.equal(hexToRgb("xyz"), null);
});

// ---------- color math ----------

test("colorDist: 0 với chính nó, đối xứng, >0 khi khác", () => {
  const a = { r: 10, g: 20, b: 30 };
  const b = { r: 200, g: 100, b: 50 };
  assert.equal(colorDist(a, a), 0);
  assert.equal(colorDist(a, b), colorDist(b, a));
  assert.ok(colorDist(a, b) > 0);
});

test("luminance & saturation theo trực giác", () => {
  assert.ok(luminance({ r: 255, g: 255, b: 255 }) > 0.95);
  assert.ok(luminance({ r: 0, g: 0, b: 0 }) < 0.05);
  assert.equal(saturation({ r: 128, g: 128, b: 128 }), 0); // xám = không bão hoà
  assert.ok(saturation({ r: 255, g: 0, b: 0 }) > 0.9); // đỏ rực
});

// ---------- contrast / readable text (lõi fix tương phản) ----------

test("contrastRatio: đen/trắng ≈ 21, giống nhau = 1", () => {
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  assert.ok(Math.abs(contrastRatio(white, black) - 21) < 0.1);
  assert.equal(contrastRatio(white, white), 1);
});

test("readableOn chọn đúng màu chữ đọc được", () => {
  assert.equal(readableOn("#ffffff"), "#111111"); // nền trắng → chữ đen
  assert.equal(readableOn("#000000"), "#ffffff"); // nền đen → chữ trắng
  assert.equal(readableOn("#facc15"), "#111111"); // vàng amber → chữ đen (đây là bug cũ: trước hardcode trắng)
  assert.equal(readableOn("#1d4ed8"), "#ffffff"); // xanh đậm → chữ trắng
  assert.equal(readableOn("rgb(255, 255, 255)"), "#111111"); // nhận cả dạng rgb()
});

// ---------- tailwind nearest ----------

test("nearestTailwind map về tên màu Tailwind gần nhất", () => {
  assert.equal(nearestTailwind("#3b82f6"), "blue-500");
  assert.equal(nearestTailwind("#ffffff"), "white");
  assert.equal(nearestTailwind("#111827"), "gray-900");
});

// ---------- scale snapping ----------

test("clusterScale snap px về candidate gần nhất theo tần suất", () => {
  const candidates = [4, 8, 16, 24, 32];
  // 15 & 17 → 16 (tổng weight 8); 31 → 32 (weight 2)
  const out = clusterScale({ "15": 5, "17": 3, "31": 2 }, candidates, 6);
  assert.deepEqual(out, [16, 32]);
});

test("clusterScale giữ top N rồi sắp tăng dần", () => {
  const candidates = [4, 8, 16, 24, 32, 48];
  const out = clusterScale(
    { "4": 1, "8": 10, "16": 8, "24": 6, "48": 2 },
    candidates,
    3
  );
  assert.deepEqual(out, [8, 16, 24]); // top-3 theo weight, sắp tăng dần
});

// ---------- slug (khóa hành vi hiện tại của CLI) ----------

test("slugFromUrl khử www, ghép path, slugify-strict", () => {
  assert.equal(slugFromUrl("https://www.Stripe.com/Foo/"), "stripecom-foo");
  assert.equal(slugFromUrl("https://example.com"), "examplecom");
});
