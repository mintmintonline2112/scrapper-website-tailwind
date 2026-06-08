import fs from "fs-extra";
import path from "node:path";
import { chromium } from "playwright";
import { runCapture, CaptureResult } from "./run.js";
import { OUTPUT_ROOT } from "./config.js";

function usage(): never {
  console.error("Cách dùng:");
  console.error("  npm run capture -- <url> [url2 url3 ...]");
  console.error("  npm run capture -- urls.txt        (mỗi dòng 1 URL, '#' = comment)");
  console.error("");
  console.error("Ví dụ:");
  console.error("  npm run capture -- https://stripe.com");
  console.error("  npm run capture -- stripe.com linear.app vercel.com");
  process.exit(1);
}

/** Gom danh sách URL từ argv: file .txt (mỗi dòng 1 URL) hoặc nhiều URL trực tiếp. */
async function collectUrls(args: string[]): Promise<string[]> {
  if (args.length === 1 && /\.txt$/i.test(args[0]) && (await fs.pathExists(args[0]))) {
    const content = await fs.readFile(args[0], "utf-8");
    return content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  }
  return args;
}

/** Ghi output/index.json + index.md tổng hợp mọi lần capture trong batch. */
async function writeBatchIndex(results: CaptureResult[]): Promise<void> {
  if (results.length === 0) return;
  const rows = results.map((r) => ({
    slug: r.slug,
    title: r.meta.title || r.url,
    url: r.url,
    finalUrl: r.meta.finalUrl,
    primary: r.tokens.palette.primary,
    accent: r.tokens.palette.accent,
    background: r.tokens.palette.background,
    fonts: r.tokens.fonts.slice(0, 2),
    components: r.components.components.length,
    capturedAt: r.meta.capturedAt,
  }));

  await fs.writeJSON(path.join(OUTPUT_ROOT, "index.json"), rows, { spaces: 2 });

  const md = `# Capture index

| Site | Slug | Primary | Components | Captured |
|---|---|---|---|---|
${rows
  .map(
    (r) =>
      `| [${r.title}](./${r.slug}/analysis/rebuild-brief.md) | \`${r.slug}\` | \`${r.primary}\` | ${r.components} | ${r.capturedAt} |`
  )
  .join("\n")}
`;
  await fs.writeFile(path.join(OUTPUT_ROOT, "index.md"), md, "utf-8");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const urls = await collectUrls(args);
  if (urls.length === 0) usage();

  // 1 URL → giữ hành vi cũ (runCapture tự quản browser). Nhiều URL → tái dùng 1 browser.
  if (urls.length === 1) {
    const result = await runCapture(urls[0]);
    console.log(`\n✅ Xong. Mở: ${result.paths.rebuildBrief}`);
    console.log(`   AI prompt: ${result.paths.aiPrompt}\n`);
    return;
  }

  console.log(`📦 Batch: ${urls.length} URL\n`);
  const browser = await chromium.launch({ headless: true });
  const ok: CaptureResult[] = [];
  const failed: { url: string; error: string }[] = [];
  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`\n── [${i + 1}/${urls.length}] ${url} ──`);
      try {
        ok.push(await runCapture(url, console.log, browser));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ❌ Bỏ qua ${url}: ${msg}`);
        failed.push({ url, error: msg });
      }
    }
  } finally {
    await browser.close();
  }

  await writeBatchIndex(ok);

  console.log(`\n✅ Batch xong: ${ok.length} thành công, ${failed.length} lỗi.`);
  if (ok.length) console.log(`   Tổng hợp: ${path.join(OUTPUT_ROOT, "index.md")}`);
  if (failed.length) {
    console.log("   Các URL lỗi:");
    for (const f of failed) console.log(`     - ${f.url}: ${f.error}`);
  }
}

main().catch((err) => {
  console.error("\n❌ Lỗi:", err);
  process.exit(1);
});
