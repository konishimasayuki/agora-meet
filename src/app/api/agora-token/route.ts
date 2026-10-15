import { NextRequest, NextResponse } from "next/server";
import { RtcTokenBuilder, RtcRole } from "agora-token";

// Agoraの入室トークンを発行する(App証明書はサーバー側だけで使う)
export async function GET(req: NextRequest) {
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  if (!appId || !appCertificate) {
    return NextResponse.json(
      { error: "AgoraのApp IDまたはApp証明書がVercelの環境変数に設定されていません。" },
      { status: 500 }
    );
  }
  const channelName = req.nextUrl.searchParams.get("channel");
  const uid = Number(req.nextUrl.searchParams.get("uid") || "0");
  if (!channelName) {
    return NextResponse.json({ error: "channelパラメータが必要です。" }, { status: 400 });
  }
  // 長い打ち合わせでも切れないよう24時間有効
  const expire = Math.floor(Date.now() / 1000) + 24 * 3600;
  const token = RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channelName, uid, RtcRole.PUBLISHER, expire, expire);
  return NextResponse.json({ token, appId, channelName, uid });
}
