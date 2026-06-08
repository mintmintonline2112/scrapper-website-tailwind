import { NextRequest, NextResponse } from "next/server";
import { normalizeUrl, slugFromUrl } from "@/lib/paths";
import { runCli, slugFromOutput } from "@/lib/cli";
import { readResult } from "@/lib/read-result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  let url: string;
  try {
    ({ url } = await req.json());
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Thiếu url" }, { status: 400 });
  }

  const normalized = normalizeUrl(url);
  let slug = slugFromUrl(normalized);
  try {
    const out = await runCli(normalized);
    slug = slugFromOutput(out, slug);
  } catch (e) {
    return NextResponse.json(
      { error: `Capture lỗi: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  return NextResponse.json(await readResult(slug));
}
