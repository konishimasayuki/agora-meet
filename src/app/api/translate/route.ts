import { NextRequest, NextResponse } from "next/server";

const NAMES: Record<string, string> = { ja: "Japanese", tr: "Turkish", en: "English" };
// 速いモデルから順に試す
const MODELS = ["claude-haiku-5-5", "claude-sonnet-4-5"];

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEYがVercelの環境変数に設定されていません。" }, { status: 500 });
  }
  try {
    const { text, from, to, context } = (await req.json()) as {
      text: string; from: string; to: string; context?: string[];
    };
    if (!text?.trim()) return NextResponse.json({ text: "" });
    if (from === to) return NextResponse.json({ text });

    const system = `You are a live interpreter in a video business meeting between a Japanese software developer (Konishi) and a small Turkish game studio that made "BenelOil", a gas station management mobile game. They are discussing localizing and releasing the game in Japan and sharing revenue.
Translate the speaker's utterance from ${NAMES[from] ?? from} into ${NAMES[to] ?? to}.
- Output ONLY the translation. No quotes, notes, or explanations.
- The text comes from speech recognition and may contain recognition errors or lack punctuation. Infer the intended meaning from context and translate naturally.
- Keep these names as-is: BenelOil, Agora, Claude, GitHub, Vercel, App Store, Google Play, Oguz, Konishi.
- Use polite business tone (Japanese: です/ます).`;

    const ctx = (context ?? []).slice(-6).join("\n");
    const content = ctx
      ? `Recent conversation (for context only, do not translate):\n${ctx}\n\nUtterance to translate:\n${text}`
      : text;

    let lastErr = "";
    for (const model of MODELS) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 800, system, messages: [{ role: "user", content }] }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const out = (data.content ?? []).map((c: { type: string; text?: string }) => (c.type === "text" ? c.text : "")).join("").trim();
        return NextResponse.json({ text: out });
      }
      lastErr = data?.error?.message || `HTTP ${res.status}`;
    }
    return NextResponse.json({ error: `翻訳に失敗しました: ${lastErr}` }, { status: 502 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "翻訳に失敗しました" }, { status: 500 });
  }
}
