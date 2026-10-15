import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";

// 非公開Blobに保存した添付ファイルを、会議アプリ経由で取り出して返す
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("p") || "";
  const name = req.nextUrl.searchParams.get("n") || "file";
  const dl = req.nextUrl.searchParams.get("dl") === "1";
  if (!p.startsWith("agora/")) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const r = await get(p, { access: "private" });
    if (!r || r.statusCode !== 200) return NextResponse.json({ error: "not found" }, { status: 404 });
    const type = r.blob.contentType || "application/octet-stream";
    // 画像・PDFはブラウザで表示、それ以外(または保存指定)はダウンロード
    const inline = !dl && (type.startsWith("image/") || type === "application/pdf");
    return new NextResponse(r.stream, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(r.blob.size),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
