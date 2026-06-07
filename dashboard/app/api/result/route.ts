import { NextRequest, NextResponse } from "next/server";
import { readResult } from "@/lib/read-result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Đọc lại kết quả của một slug đã capture (không chạy pipeline). */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "Thiếu slug" }, { status: 400 });
  try {
    const data = await readResult(slug);
    if (!data.meta) {
      return NextResponse.json({ error: "Chưa có dữ liệu cho slug này" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "slug không hợp lệ" }, { status: 400 });
  }
}
