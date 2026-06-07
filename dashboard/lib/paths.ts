import path from "node:path";

/** Repo gốc = thư mục cha của dashboard (chứa src/ và output/). */
export const REPO_ROOT = path.resolve(process.cwd(), "..");
export const OUTPUT_ROOT = path.join(REPO_ROOT, "output");

/** Slug hoá URL — phải khớp logic trong src/run.ts. */
export function normalizeUrl(input: string): string {
  return /^https?:\/\//i.test(input) ? input : `https://${input}`;
}

export function slugFromUrl(rawUrl: string): string {
  const url = new URL(normalizeUrl(rawUrl));
  const host = url.hostname.replace(/^www\./, "");
  const pathPart = url.pathname.replace(/\/+$/, "").replace(/\//g, "-");
  const slug = (host + pathPart)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "site";
}

/** Thư mục output của một slug, đã chặn path traversal. */
export function outputDir(slug: string): string {
  const dir = path.join(OUTPUT_ROOT, slug);
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(OUTPUT_ROOT))) {
    throw new Error("Invalid slug");
  }
  return resolved;
}

/** Giải một đường dẫn con trong output/<slug>, chặn traversal ra ngoài. */
export function safeFile(slug: string, rel: string): string {
  const base = outputDir(slug);
  const resolved = path.resolve(base, rel);
  if (!resolved.startsWith(base)) throw new Error("Invalid path");
  return resolved;
}
