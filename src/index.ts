import { runCapture } from "./run.js";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Cách dùng: npm run capture -- <url>");
    console.error("Ví dụ:     npm run capture -- https://example.com");
    process.exit(1);
  }

  const result = await runCapture(arg);
  console.log(`\n✅ Xong. Mở: ${result.paths.rebuildBrief}`);
  console.log(`   AI prompt: ${result.paths.aiPrompt}\n`);
}

main().catch((err) => {
  console.error("\n❌ Lỗi:", err);
  process.exit(1);
});
