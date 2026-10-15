"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { guessLang, t, type Lang } from "@/lib/i18n";

// 入口: ルーム名を決めて会議室へ
export default function Home() {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>("ja");
  const [room, setRoom] = useState("");
  useEffect(() => setLang(guessLang()), []);
  const L = t(lang);
  const slug = room.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

  return (
    <main className="gate">
      <div className="gate-box">
        <h1 className="wordmark">Agora<span /></h1>
        <p className="lead">{L.tagline}</p>
        <label className="field">
          <span>{L.roomName}</span>
          <input className="input" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="beneloil" />
        </label>
        <button
          className="primary"
          onClick={() => router.push(`/room/${slug || Math.random().toString(36).slice(2, 8)}`)}
        >
          {L.createRoom}
        </button>
      </div>
    </main>
  );
}
