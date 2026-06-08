"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Palette {
  background: string;
  text: string;
  primary: string;
  accent: string;
  border: string;
  all: { hex: string; weight: number }[];
}
interface SimplePalette {
  background: string;
  text: string;
  primary: string;
  accent: string;
  border: string;
}
interface Tokens {
  palette: Palette;
  darkPalette?: SimplePalette;
  spacingScale: number[];
  typeScale: number[];
  radiusScale: number[];
  fonts: string[];
  fontWeights: number[];
  layout: { containerMaxWidth: string; commonGridColumns: string[] };
  tailwindHints: Record<string, string>;
}
interface A11y {
  score: number;
  contrast: { checked: number; failed: number };
  images: { total: number; missingAlt: number };
  headings: { h1Count: number; skips: string[] };
  controls: { unnamedButtons: number; unnamedLinks: number };
}
interface CaptureResult {
  slug: string;
  url: string;
  meta: { title?: string; description?: string; finalUrl?: string } | null;
  layout: {
    headings: { tag: string; text: string }[];
    buttons: { text: string; role: string }[];
    images: unknown[];
    sections: { role: string; cardCount: number }[];
    cards?: { count: number; heading: string }[];
  } | null;
  tokens: Tokens | null;
  components: { components: { name: string; role: string; contains: string[] }[] } | null;
  rebuildBrief: string | null;
  aiPrompt: string | null;
  accessibility: A11y | null;
  screenshots: string[];
  rebuildFiles: string[];
  rebuildHtmlFiles: string[];
}
interface HistoryItem {
  slug: string;
  title: string;
  url: string;
  capturedAt: string | null;
}

const VIEWPORTS = ["desktop", "tablet", "mobile"] as const;

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [vp, setVp] = useState<(typeof VIEWPORTS)[number]>("desktop");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [openFile, setOpenFile] = useState<{ name: string; content: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewDark, setPreviewDark] = useState(false);
  const [previewW, setPreviewW] = useState<number>(0); // 0 = full
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMode, setPreviewMode] = useState<"react" | "html">("react");
  const [claudeCopied, setClaudeCopied] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/history");
      const data = await res.json();
      setHistory(data.items ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  async function capture(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setOpenFile(null);
    setPreview(null);
    setLogs([]);
    try {
      const res = await fetch("/api/capture-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.body) throw new Error("Không có stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "log") setLogs((p) => [...p, ev.line]);
          else if (ev.type === "error") setError(ev.error);
          else if (ev.type === "result") setResult(ev);
        }
      }
      loadHistory();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadExisting(slug: string) {
    setError(null);
    setOpenFile(null);
    setPreview(null);
    setLogs([]);
    try {
      const res = await fetch(`/api/result?slug=${encodeURIComponent(slug)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const fileUrl = (rel: string, download = false) =>
    `/api/file?slug=${result!.slug}&path=${encodeURIComponent(rel)}${download ? "&download=1" : ""}`;

  async function copyPrompt() {
    if (!result?.aiPrompt) return;
    await navigator.clipboard.writeText(result.aiPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function viewFile(rel: string, dir = "rebuild") {
    const res = await fetch(fileUrl(`${dir}/${rel}`));
    setOpenFile({ name: rel, content: await res.text() });
  }

  /** Copy ai-prompt vào clipboard rồi mở Claude.ai để dán — không tốn API. */
  async function copyAndOpenClaude() {
    if (result?.aiPrompt) {
      try {
        await navigator.clipboard.writeText(result.aiPrompt);
        setClaudeCopied(true);
        setTimeout(() => setClaudeCopied(false), 4000);
      } catch {
        /* clipboard bị chặn — vẫn mở tab */
      }
    }
    window.open("https://claude.ai/new", "_blank", "noopener,noreferrer");
  }

  async function loadPreview(mode: "react" | "html") {
    if (!result) return;
    setPreviewLoading(true);
    setPreviewMode(mode);
    try {
      let html: string;
      if (mode === "react") {
        const res = await fetch(fileUrl("rebuild/preview.html"));
        if (!res.ok) throw new Error("Chưa có preview.html");
        html = await res.text();
        const base = `/api/file?slug=${result.slug}&path=rebuild%2Fpublic%2Fimages%2F`;
        html = html.split('src="public/images/').join(`src="${base}`);
      } else {
        // bản vanilla: gộp CSS/JS vào srcDoc (iframe không có base để load file rời),
        // ảnh assets/ trỏ về API file.
        const [idx, css, js] = await Promise.all([
          fetch(fileUrl("rebuild-html/index.html")).then((r) => {
            if (!r.ok) throw new Error("Chưa có rebuild-html/index.html");
            return r.text();
          }),
          fetch(fileUrl("rebuild-html/styles.css")).then((r) => (r.ok ? r.text() : "")),
          fetch(fileUrl("rebuild-html/script.js")).then((r) => (r.ok ? r.text() : "")),
        ]);
        const base = `/api/file?slug=${result.slug}&path=rebuild-html%2Fassets%2F`;
        html = idx
          .replace('<link rel="stylesheet" href="styles.css">', `<style>${css}</style>`)
          .replace('<script src="script.js"></script>', `<script>${js}</script>`)
          .split('src="assets/')
          .join(`src="${base}`);
      }
      setPreview(html);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl gap-6 px-6 py-10">
      {/* History sidebar */}
      <aside className="hidden w-56 shrink-0 lg:block">
        <h2 className="mb-3 text-sm font-semibold text-neutral-400">Lịch sử capture</h2>
        <ul className="space-y-1">
          {history.length === 0 && <li className="text-xs text-neutral-600">Chưa có</li>}
          {history.map((h) => (
            <li key={h.slug}>
              <button
                onClick={() => loadExisting(h.slug)}
                className={`w-full truncate rounded-md px-2.5 py-1.5 text-left text-xs transition hover:bg-neutral-800 ${
                  result?.slug === h.slug ? "bg-neutral-800 text-white" : "text-neutral-400"
                }`}
                title={h.url}
              >
                {h.title || h.slug}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">UI Capture &amp; Analyzer</h1>
          <p className="mt-1 text-neutral-400">
            DOM/CSS reference scraper + screenshot. Computed CSS là nguồn sự thật.
          </p>
        </header>

        <form onSubmit={capture} className="flex gap-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://stripe.com"
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-neutral-400"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-white px-6 py-3 font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-50"
          >
            {loading ? "Đang capture…" : "Capture"}
          </button>
        </form>

        {/* Live log */}
        {(loading || logs.length > 0) && (
          <pre className="mt-4 max-h-48 overflow-auto rounded-lg border border-neutral-800 bg-black/60 p-3 text-xs text-neutral-400">
            {logs.join("\n")}
            <div ref={logEndRef} />
          </pre>
        )}
        {error && (
          <p className="mt-6 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-red-300">
            ❌ {error}
          </p>
        )}

        {result && (
          <section className="mt-8 space-y-10">
            {/* Summary + downloads */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold">{result.meta?.title || result.url}</h2>
                <p className="truncate text-sm text-neutral-400">{result.meta?.finalUrl || result.url}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={fileUrl("analysis/rebuild-brief.md", true)} className="btn">Brief.md</a>
                <a href={fileUrl("analysis/design-tokens.json", true)} className="btn">tokens.json</a>
                <a href={fileUrl("analysis/ai-prompt.md", true)} className="btn">ai-prompt.md</a>
                <a href={fileUrl("analysis/accessibility.md", true)} className="btn">a11y.md</a>
                <a href={`/api/zip?slug=${result.slug}`} className="btn btn-primary">⬇ ZIP</a>
              </div>
            </div>

            {/* Screenshots */}
            <div>
              <div className="mb-3 flex gap-2">
                {VIEWPORTS.map((v) => (
                  <button
                    key={v}
                    onClick={() => setVp(v)}
                    className={`rounded-md px-3 py-1.5 text-sm capitalize ${
                      vp === v ? "bg-white text-neutral-900" : "bg-neutral-800 text-neutral-300"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {(["above-fold", "full"] as const).map((kind) => (
                  <figure key={kind} className="overflow-hidden rounded-xl border border-neutral-800">
                    <figcaption className="border-b border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-400">
                      {vp} · {kind}
                    </figcaption>
                    <img
                      src={fileUrl(`screenshots/${vp}-${kind}.png`)}
                      alt={`${vp} ${kind}`}
                      className="max-h-[480px] w-full bg-white object-contain"
                    />
                  </figure>
                ))}
              </div>
            </div>

            {/* Live preview */}
            {result.rebuildFiles?.includes("preview.html") && (
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="mr-2 text-lg font-semibold">Live preview</h3>
                  <button
                    onClick={() => loadPreview("react")}
                    className={`btn ${preview && previewMode === "react" ? "btn-primary" : ""}`}
                  >
                    {previewLoading && previewMode === "react" ? "Đang tải…" : "React (Next)"}
                  </button>
                  {result.rebuildHtmlFiles?.includes("index.html") && (
                    <button
                      onClick={() => loadPreview("html")}
                      className={`btn ${preview && previewMode === "html" ? "btn-primary" : ""}`}
                    >
                      {previewLoading && previewMode === "html" ? "Đang tải…" : "HTML (vanilla)"}
                    </button>
                  )}
                  {preview && (
                    <>
                      <button
                        onClick={() => setPreviewDark((v) => !v)}
                        className="btn"
                      >
                        {previewDark ? "☾ Dark" : "☀ Light"}
                      </button>
                      <span className="ml-2 flex gap-1">
                        {[
                          { label: "Full", w: 0 },
                          { label: "1440", w: 1440 },
                          { label: "768", w: 768 },
                          { label: "390", w: 390 },
                        ].map((o) => (
                          <button
                            key={o.w}
                            onClick={() => setPreviewW(o.w)}
                            className={`rounded-md px-2.5 py-1.5 text-xs ${
                              previewW === o.w ? "bg-white text-neutral-900" : "bg-neutral-800 text-neutral-300"
                            }`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </span>
                    </>
                  )}
                </div>
                {preview ? (
                  <div className="overflow-auto rounded-xl border border-neutral-800 bg-white">
                    <iframe
                      title="preview"
                      sandbox="allow-scripts"
                      srcDoc={
                        previewDark
                          ? previewMode === "html"
                            ? preview.replace("<html ", '<html data-theme="dark" ')
                            : preview.replace("<html lang=", '<html class="dark" lang=')
                          : preview
                      }
                      style={{
                        width: previewW ? `${previewW}px` : "100%",
                        height: 720,
                        border: 0,
                        display: "block",
                        margin: previewW ? "0 auto" : undefined,
                      }}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-neutral-500">
                    Chọn <b>React (Next)</b> hoặc <b>HTML (vanilla)</b> để xem trang rebuild ngay tại đây — không cần dựng app.
                  </p>
                )}
              </div>
            )}

            {/* Palette + tokens */}
            {result.tokens && (
              <div>
                <h3 className="mb-3 text-lg font-semibold">Design tokens</h3>
                <div className="mb-4 flex flex-wrap gap-3">
                  {Object.entries({
                    background: result.tokens.palette.background,
                    text: result.tokens.palette.text,
                    primary: result.tokens.palette.primary,
                    accent: result.tokens.palette.accent,
                    border: result.tokens.palette.border,
                  }).map(([role, hex]) => (
                    <Swatch key={role} role={role} hex={hex} />
                  ))}
                </div>
                <div className="grid gap-3 text-sm md:grid-cols-2">
                  <TokenRow label="Spacing (px)" value={result.tokens.spacingScale.join(" / ")} />
                  <TokenRow label="Type scale (px)" value={result.tokens.typeScale.join(" / ")} />
                  <TokenRow label="Radius (px)" value={result.tokens.radiusScale.join(" / ")} />
                  <TokenRow label="Fonts" value={result.tokens.fonts.join(", ") || "—"} />
                  <TokenRow label="Container" value={result.tokens.layout.containerMaxWidth} />
                  <TokenRow label="Tailwind primary" value={result.tokens.tailwindHints.primary} />
                </div>
                {result.tokens.darkPalette && (
                  <div className="mt-4">
                    <div className="mb-2 text-sm text-neutral-400">Dark mode palette (đo từ prefers-color-scheme)</div>
                    <div className="flex flex-wrap gap-3">
                      {Object.entries({
                        background: result.tokens.darkPalette.background,
                        text: result.tokens.darkPalette.text,
                        primary: result.tokens.darkPalette.primary,
                        accent: result.tokens.darkPalette.accent,
                        border: result.tokens.darkPalette.border,
                      }).map(([role, hex]) => (
                        <Swatch key={role} role={role} hex={hex} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Accessibility audit (trang gốc) */}
            {result.accessibility && (
              <div>
                <h3 className="mb-3 text-lg font-semibold">Accessibility (trang gốc)</h3>
                <div className="flex flex-wrap items-center gap-4">
                  <ScoreRing score={result.accessibility.score} />
                  <div className="grid flex-1 gap-2 text-sm sm:grid-cols-2">
                    <TokenRow
                      label="Contrast fail"
                      value={`${result.accessibility.contrast.failed} / ${result.accessibility.contrast.checked}`}
                    />
                    <TokenRow
                      label="Ảnh thiếu alt"
                      value={`${result.accessibility.images.missingAlt} / ${result.accessibility.images.total}`}
                    />
                    <TokenRow label="Số h1" value={String(result.accessibility.headings.h1Count)} />
                    <TokenRow
                      label="Control vô danh"
                      value={String(
                        result.accessibility.controls.unnamedButtons +
                          result.accessibility.controls.unnamedLinks
                      )}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Components */}
            {result.components && (
              <div>
                <h3 className="mb-3 text-lg font-semibold">
                  Component breakdown ({result.components.components.length})
                </h3>
                <ul className="grid gap-2 md:grid-cols-2">
                  {result.components.components.map((c, i) => (
                    <li key={i} className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-2 text-xs text-neutral-500">{c.role}</span>
                      {c.contains.length > 0 && (
                        <p className="mt-1 text-xs text-neutral-400">{c.contains.join(" · ")}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Generated code (Phase 6) */}
            {result.rebuildFiles && result.rebuildFiles.length > 0 && (
              <div>
                <h3 className="mb-3 text-lg font-semibold">
                  Code sinh ra · rebuild/ ({result.rebuildFiles.length} files)
                </h3>
                <div className="flex flex-wrap gap-2">
                  {result.rebuildFiles.map((f) => (
                    <button
                      key={f}
                      onClick={() => viewFile(f)}
                      className="rounded-md border border-neutral-800 bg-neutral-900/50 px-2.5 py-1.5 font-mono text-xs text-neutral-300 hover:bg-neutral-800"
                    >
                      {f}
                    </button>
                  ))}
                </div>
                {openFile && (
                  <div className="mt-3 overflow-hidden rounded-xl border border-neutral-800">
                    <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs">
                      <span className="font-mono text-neutral-400">{openFile.name}</span>
                      <button onClick={() => setOpenFile(null)} className="text-neutral-500 hover:text-white">✕</button>
                    </div>
                    <pre className="max-h-[500px] overflow-auto p-4 text-xs text-neutral-300">{openFile.content}</pre>
                  </div>
                )}
              </div>
            )}

            {/* Generated code — bản vanilla HTML/CSS/JS */}
            {result.rebuildHtmlFiles && result.rebuildHtmlFiles.length > 0 && (
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <h3 className="text-lg font-semibold">
                    Code sinh ra · rebuild-html/ ({result.rebuildHtmlFiles.length} files)
                  </h3>
                  <a href={fileUrl("rebuild-html/index.html", true)} className="btn">⬇ index.html</a>
                  <span className="text-xs text-neutral-500">Mở thẳng index.html bằng trình duyệt — không cần build.</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {result.rebuildHtmlFiles
                    .filter((f) => !f.startsWith("assets/"))
                    .map((f) => (
                      <button
                        key={f}
                        onClick={() => viewFile(f, "rebuild-html")}
                        className="rounded-md border border-neutral-800 bg-neutral-900/50 px-2.5 py-1.5 font-mono text-xs text-neutral-300 hover:bg-neutral-800"
                      >
                        {f}
                      </button>
                    ))}
                </div>
              </div>
            )}

            {/* AI prompt with copy */}
            {result.aiPrompt && (
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/50">
                <div className="flex items-center justify-between px-5 py-3">
                  <h3 className="font-semibold">AI prompt (Next.js + Tailwind)</h3>
                  <button onClick={copyPrompt} className="btn">{copied ? "✓ Đã copy" : "Copy"}</button>
                </div>
                <pre className="max-h-[400px] overflow-auto border-t border-neutral-800 p-5 text-xs text-neutral-300">
                  {result.aiPrompt}
                </pre>
              </div>
            )}

            {/* Generate bằng Claude.ai (miễn phí — dùng gói chat sẵn có, không cần API) */}
            {result.aiPrompt && (
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/50">
                <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <h3 className="font-semibold">✨ Sinh trang hoàn chỉnh bằng Claude.ai</h3>
                    <p className="text-xs text-neutral-500">
                      Copy ai-prompt rồi mở Claude.ai, dán (Ctrl+V) vào khung chat — dùng gói sẵn có, không tốn API.
                    </p>
                  </div>
                  <button onClick={copyAndOpenClaude} className="btn btn-primary">
                    Copy prompt &amp; mở Claude.ai →
                  </button>
                </div>
                {claudeCopied && (
                  <p className="border-t border-neutral-800 px-5 py-2 text-xs text-green-400">
                    ✓ Đã copy prompt vào clipboard — sang tab Claude.ai vừa mở và dán (Ctrl+V) vào khung chat.
                  </p>
                )}
              </div>
            )}

            {/* Rebuild brief */}
            {result.rebuildBrief && (
              <details className="rounded-xl border border-neutral-800 bg-neutral-900/50">
                <summary className="cursor-pointer px-5 py-3 font-semibold">Rebuild brief (markdown)</summary>
                <pre className="max-h-[500px] overflow-auto border-t border-neutral-800 p-5 text-xs text-neutral-300">
                  {result.rebuildBrief}
                </pre>
              </details>
            )}
          </section>
        )}
      </main>

      <style>{`
        .btn { border:1px solid #404040; border-radius:0.5rem; padding:0.5rem 0.9rem; font-size:0.875rem; transition:background .15s; }
        .btn:hover { background:#262626; }
        .btn-primary { background:#fff; color:#171717; border-color:#fff; }
        .btn-primary:hover { background:#e5e5e5; }
      `}</style>
    </div>
  );
}

function Swatch({ role, hex }: { role: string; hex: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
      <span className="h-8 w-8 rounded-md border border-neutral-700" style={{ background: hex }} />
      <div className="text-xs">
        <div className="capitalize text-neutral-400">{role}</div>
        <div className="font-mono">{hex}</div>
      </div>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 90 ? "#22c55e" : score >= 70 ? "#eab308" : "#ef4444";
  return (
    <div
      className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-xl font-bold"
      style={{ background: `conic-gradient(${color} ${score * 3.6}deg, #262626 0deg)` }}
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-950">
        {score}
      </span>
    </div>
  );
}

function TokenRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-2.5">
      <span className="text-neutral-400">{label}</span>
      <span className="font-mono text-neutral-200">{value}</span>
    </div>
  );
}
