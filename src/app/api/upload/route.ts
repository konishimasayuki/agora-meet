import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

// 会議中の添付ファイル: ブラウザからVercel Blobへ直接アップロードするための許可を出す
export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Vercel Blobが未接続です。VercelのStorageでBlobを作成し、このプロジェクトに接続してください。" },
      { status: 500 }
    );
  }
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("agora/")) throw new Error("invalid path");
        return {
          maximumSizeInBytes: 100 * 1024 * 1024, // 100MBまで
          addRandomSuffix: true, // 推測されにくいURLにする
        };
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "upload error" }, { status: 400 });
  }
}
