"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  ILocalVideoTrack,
  IMicrophoneAudioTrack,
  UID,
} from "agora-rtc-sdk-ng";
import { LANGS, guessLang, t, type Lang } from "@/lib/i18n";

// ===== 型 =====
type Peer = { uid: number; name: string; lang: Lang | ""; sharing: boolean };
type Entry = {
  id: string;
  uid: number;
  name: string;
  lang: Lang;
  original: string;
  translated?: string;
  pending?: boolean;
  mine: boolean;
  ts: number;
  kind?: Kind;
  file?: FileInfo;
};
type Kind = "voice" | "chat" | "file";
type FileInfo = { name: string; url: string; size: number; type: string };
// 参加者同士で送り合うデータ(Agoraのデータストリーム、1件1KBまで)
type Wire =
  | { t: "hello"; name: string; lang: Lang; sharing: boolean }
  | { t: "say"; id: string; name: string; lang: Lang; text: string; ts?: number; past?: boolean; kind?: Kind; file?: FileInfo }
  | { t: "share"; on: boolean };

type StreamClient = { sendStreamMessage: (p: string | Uint8Array, retry?: boolean) => Promise<void> };
type SR = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const PREF_KEY = "agora-meet:profile";
const CHUNK = 250; // 1KB制限に収めるための1回あたりの文字数
const RESEND = 30; // 途中参加者へ送り直す自分の発言数

function splitText(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += CHUNK) out.push(s.slice(i, i + CHUNK));
  return out;
}
// 参加者ごとの色(ログ・字幕・名前で共通)
const COLORS = ["#A9B98E", "#E2A77F", "#8FB8D6", "#D7A5C4", "#E3CF7E", "#9FD1C2"];
const colorOf = (uid: number) => COLORS[uid % COLORS.length];

const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function RoomPage() {
  const params = useParams<{ id: string }>();
  const room = decodeURIComponent(params.id || "lobby");

  const [lang, setLang] = useState<Lang>("ja");
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<"lobby" | "in" | "left">("lobby");
  const [error, setError] = useState("");

  // 前回の名前・言語を復元(端末内の入力補助のみ)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
      if (saved?.name) setName(saved.name);
      setLang(saved?.lang || guessLang());
    } catch {
      setLang(guessLang());
    }
  }, []);

  const L = t(lang);

  if (phase !== "in") {
    return (
      <main className="gate">
        <div className="gate-box">
          <h1 className="wordmark">Agora<span /></h1>
          <p className="lead">{phase === "left" ? L.left : L.tagline}</p>
          <label className="field">
            <span>{L.yourName}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
          </label>
          <div className="field">
            <span>{L.yourLang}</span>
            <div className="seg" role="group">
              {LANGS.map((l) => (
                <button key={l.code} type="button" aria-pressed={lang === l.code} onClick={() => setLang(l.code)}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <button
            className="primary"
            disabled={!name.trim()}
            onClick={() => {
              try { localStorage.setItem(PREF_KEY, JSON.stringify({ name: name.trim(), lang })); } catch {}
              setError("");
              setPhase("in");
            }}
          >
            {phase === "left" ? L.rejoin : L.join}
          </button>
          <p className="note">{L.tip}</p>
          {error && <p className="err">{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <Meeting
      room={room}
      name={name.trim()}
      lang={lang}
      onError={(m) => { setError(m); setPhase("lobby"); }}
      onLeave={() => setPhase("left")}
    />
  );
}

// ===== 会議本体 =====
function Meeting({
  room, name, lang, onError, onLeave,
}: {
  room: string; name: string; lang: Lang;
  onError: (m: string) => void; onLeave: () => void;
}) {
  const L = t(lang);
  const uidRef = useRef<number>(Math.floor(Math.random() * 1_000_000_000) + 1);
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const micRef = useRef<IMicrophoneAudioTrack | null>(null);
  const camRef = useRef<ICameraVideoTrack | null>(null);
  const screenRef = useRef<ILocalVideoTrack | null>(null);
  const localEl = useRef<HTMLDivElement | null>(null);
  const playedFit = useRef<Map<number, string>>(new Map());
  const logEnd = useRef<HTMLDivElement | null>(null);
  const entriesRef = useRef<Entry[]>([]);
  const srRef = useRef<SR | null>(null);
  const srWanted = useRef(false);

  const [peers, setPeers] = useState<Peer[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [hasCam, setHasCam] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [srSupported, setSrSupported] = useState(true);
  const [banner, setBanner] = useState("");
  const [copied, setCopied] = useState(false);
  const [captions, setCaptions] = useState<Entry[]>([]);
  const [speaking, setSpeaking] = useState<Set<number>>(new Set());

  // 他の箇所から最新の状態を参照するため
  const sharingRef = useRef(false);
  sharingRef.current = sharing;

  const updateEntries = useCallback((fn: (prev: Entry[]) => Entry[]) => {
    setEntries((prev) => {
      const next = fn(prev);
      entriesRef.current = next;
      return next;
    });
  }, []);

  // ===== データ送信 =====
  const send = useCallback(async (msg: Wire) => {
    const c = clientRef.current as unknown as StreamClient | null;
    if (!c) return;
    try {
      await c.sendStreamMessage(JSON.stringify(msg), true);
    } catch {
      // 送信失敗(切断中など)は無視
    }
  }, []);

  const sayHello = useCallback(() => {
    send({ t: "hello", name, lang, sharing: sharingRef.current });
  }, [send, name, lang]);

  // 途中参加・再読み込みした人のために、自分の直近の発言を少しずつ送り直す
  const resendMine = useCallback(async () => {
    const mine = entriesRef.current.filter((e) => e.mine).slice(-RESEND);
    for (const e of mine) {
      await send({ t: "say", id: e.id, name: e.name, lang: e.lang, text: e.original, ts: e.ts, past: true, kind: e.kind, file: e.file });
      await new Promise((r) => setTimeout(r, 300)); // 送信量の上限に当たらないよう間隔をあける
    }
  }, [send]);

  // ===== 翻訳 =====
  const translate = useCallback(async (entry: Entry) => {
    const context = entriesRef.current
      .filter((e) => e.id !== entry.id)
      .slice(-6)
      .map((e) => `${e.name}: ${e.original}`);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: entry.original, from: entry.lang, to: lang, context }),
      });
      const data = await res.json();
      const translated = res.ok ? data.text : `(${data.error || "翻訳エラー"})`;
      updateEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, translated, pending: false } : e)));
      setCaptions((cs) => cs.map((c) => (c.id === entry.id ? { ...c, translated, pending: false } : c)));
    } catch {
      updateEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, translated: "(翻訳エラー)", pending: false } : e)));
    }
  }, [lang, updateEntries]);

  // 受信した発言をログに追加
  const receiveSay = useCallback((uid: number, msg: Extract<Wire, { t: "say" }>) => {
    // 送り直しで同じ発言が届いた場合は無視
    if (entriesRef.current.some((e) => e.id === msg.id)) return;
    const needs = msg.lang !== lang && msg.kind !== "file";
    const entry: Entry = {
      id: msg.id, uid, name: msg.name, lang: msg.lang, original: msg.text,
      pending: needs, translated: needs ? undefined : msg.text, mine: false, ts: msg.ts || Date.now(),
      kind: msg.kind || "voice", file: msg.file,
    };
    updateEntries((prev) => (prev.some((e) => e.id === entry.id) ? prev : [...prev, entry].sort((a, b) => a.ts - b.ts)));
    if (msg.past) {
      if (needs) translate(entry);
      return;
    }
    // 字幕は最新3件まで。同じ人の古い字幕は新しいものに置き換える
    if (entry.kind === "file") return; // ファイルは字幕に出さずログだけ
    setCaptions((cs) => [...cs.filter((c) => c.uid !== uid), entry].slice(-3));
    setTimeout(() => setCaptions((cs) => cs.filter((c) => c.id !== entry.id)), 10000);
    if (needs) translate(entry);
  }, [lang, translate, updateEntries]);

  // 自分の発言を送る
  const speak = useCallback((text: string, kind: Kind = "voice") => {
    const clean = text.trim();
    if (!clean) return;
    for (const part of splitText(clean)) {
      const id = `${uidRef.current}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const entry: Entry = { id, uid: uidRef.current, name, lang, original: part, translated: part, mine: true, ts: Date.now(), kind };
      updateEntries((prev) => [...prev, entry]);
      send({ t: "say", id, name, lang, text: part, ts: entry.ts, kind });
    }
  }, [name, lang, send, updateEntries]);

  // ファイルを共有(アップロード後にURLを送る)
  const shareFile = useCallback((file: FileInfo) => {
    const id = `${uidRef.current}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const entry: Entry = { id, uid: uidRef.current, name, lang, original: file.name, translated: file.name, mine: true, ts: Date.now(), kind: "file", file };
    updateEntries((prev) => [...prev, entry]);
    send({ t: "say", id, name, lang, text: file.name, ts: entry.ts, kind: "file", file });
  }, [name, lang, send, updateEntries]);

  // ===== 音声認識 =====
  const startSR = useCallback(() => {
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) { setSrSupported(false); return; }
    srWanted.current = true;
    if (srRef.current) return;
    const rec = new Ctor();
    rec.lang = LANGS.find((l) => l.code === lang)?.sr || "ja-JP";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) speak(r[0].transcript, "voice");
        else live += r[0].transcript;
      }
      setInterim(live);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        srWanted.current = false;
        setBanner(L.noSr);
      }
    };
    // Chromeは無音が続くと止まるので、マイクがオンの間は自動で再開する
    rec.onend = () => {
      srRef.current = null;
      setInterim("");
      if (srWanted.current) setTimeout(() => { if (srWanted.current) startSR(); }, 250);
    };
    srRef.current = rec;
    try { rec.start(); } catch { srRef.current = null; }
  }, [lang, speak, L.noSr]);

  const stopSR = useCallback(() => {
    srWanted.current = false;
    const r = srRef.current;
    srRef.current = null;
    try { r?.stop(); } catch {}
    setInterim("");
  }, []);

  // ===== 接続 =====
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
        AgoraRTC.setLogLevel(3);
        const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        clientRef.current = client;
        client.enableAudioVolumeIndicator();
        client.on("volume-indicator", (vols: { uid: UID; level: number }[]) => {
          setSpeaking(new Set(vols.filter((v) => v.level > 5).map((v) => (Number(v.uid) === 0 ? uidRef.current : Number(v.uid)))));
        });

        const upsertPeer = (uid: number, patch: Partial<Peer>) =>
          setPeers((prev) => {
            const i = prev.findIndex((p) => p.uid === uid);
            if (i < 0) return [...prev, { uid, name: "", lang: "", sharing: false, ...patch }];
            const next = [...prev];
            next[i] = { ...next[i], ...patch };
            return next;
          });

        client.on("user-joined", (u: IAgoraRTCRemoteUser) => {
          upsertPeer(Number(u.uid), {});
          // 新しく来た人に自分の名前とこれまでの発言を知らせる
          setTimeout(() => sayHello(), 800);
          setTimeout(() => { resendMine(); }, 1500);
        });
        client.on("user-left", (u: IAgoraRTCRemoteUser) => {
          playedFit.current.delete(Number(u.uid));
          setPeers((prev) => prev.filter((p) => p.uid !== Number(u.uid)));
        });
        client.on("user-published", async (u: IAgoraRTCRemoteUser, mediaType) => {
          await client.subscribe(u, mediaType);
          upsertPeer(Number(u.uid), {});
          if (mediaType === "audio") u.audioTrack?.play();
          if (mediaType === "video") {
            playedFit.current.delete(Number(u.uid));
            setPeers((prev) => [...prev]); // 再描画して映像を貼り付け
          }
        });
        client.on("user-unpublished", (u: IAgoraRTCRemoteUser, mediaType) => {
          if (mediaType === "video") {
            playedFit.current.delete(Number(u.uid));
            setPeers((prev) => [...prev]);
          }
        });
        client.on("stream-message", (uid: UID, payload: Uint8Array) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload)) as Wire;
            const n = Number(uid);
            if (msg.t === "hello") upsertPeer(n, { name: msg.name, lang: msg.lang, sharing: msg.sharing });
            else if (msg.t === "share") {
              playedFit.current.delete(n);
              upsertPeer(n, { sharing: msg.on });
            } else if (msg.t === "say") receiveSay(n, msg);
          } catch {}
        });

        const res = await fetch(`/api/agora-token?channel=${encodeURIComponent(room)}&uid=${uidRef.current}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "トークンの取得に失敗しました");
        await client.join(data.appId, data.channelName, data.token, uidRef.current);
        if (cancelled) return;

        const mic = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true });
        micRef.current = mic;
        const tracks: (IMicrophoneAudioTrack | ICameraVideoTrack)[] = [mic];
        try {
          const cam = await AgoraRTC.createCameraVideoTrack({ encoderConfig: "720p_1" });
          camRef.current = cam;
          tracks.push(cam);
          setHasCam(true);
          if (localEl.current) cam.play(localEl.current, { fit: "cover", mirror: true });
        } catch {
          setCamOn(false);
        }
        await client.publish(tracks);
        if (cancelled) return;
        sayHello();
        startSR();
      } catch (e) {
        if (!cancelled) onError(e instanceof Error ? e.message : "接続に失敗しました");
      }
    })();

    return () => {
      cancelled = true;
      stopSR();
      micRef.current?.close();
      camRef.current?.close();
      screenRef.current?.close();
      micRef.current = null;
      camRef.current = null;
      screenRef.current = null;
      const c = clientRef.current;
      if (c) {
        c.removeAllListeners();
        c.leave().catch(() => {});
      }
      clientRef.current = null;
    };
    // 接続は入室時の1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 相手の映像を各タイルに貼り付ける(画面共有中は全体が見えるようにcontain)
  useEffect(() => {
    const c = clientRef.current;
    if (!c) return;
    for (const u of c.remoteUsers) {
      const uid = Number(u.uid);
      const el = document.getElementById(`tile-${uid}`);
      const track = u.videoTrack;
      if (!el || !track) continue;
      const fit = peers.find((p) => p.uid === uid)?.sharing ? "contain" : "cover";
      if (playedFit.current.get(uid) === fit && track.isPlaying) continue;
      track.stop();
      track.play(el, { fit });
      playedFit.current.set(uid, fit);
    }
  }, [peers]);

  // ログを最新位置へスクロール
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "end" });
  }, [entries.length, interim]);

  // ===== 操作 =====
  const toggleMic = async () => {
    const m = micRef.current;
    if (!m) return;
    const next = !micOn;
    await m.setEnabled(next);
    setMicOn(next);
    if (next) startSR(); else stopSR();
  };

  const toggleCam = async () => {
    const c = camRef.current;
    if (!c || sharing) return;
    const next = !camOn;
    await c.setEnabled(next);
    setCamOn(next);
  };

  const stopShare = useCallback(async () => {
    const client = clientRef.current;
    const scr = screenRef.current;
    screenRef.current = null;
    if (client && scr) {
      await client.unpublish(scr).catch(() => {});
      scr.close();
    }
    const cam = camRef.current;
    if (client && cam) {
      await client.publish(cam).catch(() => {});
      if (localEl.current) cam.play(localEl.current, { fit: "cover", mirror: true });
    }
    setSharing(false);
    send({ t: "share", on: false });
  }, [send]);

  const startShare = async () => {
    const client = clientRef.current;
    if (!client) return;
    if (!navigator.mediaDevices || !("getDisplayMedia" in navigator.mediaDevices)) {
      setBanner(L.noShare);
      return;
    }
    try {
      const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
      const scr = (await AgoraRTC.createScreenVideoTrack({ encoderConfig: "1080p_1", optimizationMode: "detail" }, "disable")) as ILocalVideoTrack;
      // Agoraは1人につき映像1本なので、共有中はカメラを止めて画面を送る
      const cam = camRef.current;
      if (cam) {
        cam.stop();
        await client.unpublish(cam).catch(() => {});
      }
      await client.publish(scr);
      screenRef.current = scr;
      if (localEl.current) scr.play(localEl.current, { fit: "contain" });
      scr.on("track-ended", () => { stopShare(); });
      setSharing(true);
      send({ t: "share", on: true });
    } catch {
      // ユーザーが共有ダイアログを閉じた場合など
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const sendChat = () => {
    if (!draft.trim()) return;
    speak(draft, "chat");
    setDraft("");
  };

  const attach = async (f: File) => {
    setUploading(f.name);
    setBanner("");
    try {
      const { upload } = await import("@vercel/blob/client");
      const safe = f.name.replace(/[\\/?#%]+/g, "_").slice(-80);
      // 非公開で保存し、アプリ経由(/api/file)でだけ開けるようにする
      const blob = await upload(`agora/${room}/${safe}`, f, { access: "private", handleUploadUrl: "/api/upload" });
      const fname = f.name.slice(-80);
      shareFile({ name: fname, url: `/api/file?p=${encodeURIComponent(blob.pathname)}&n=${encodeURIComponent(fname)}`, size: f.size, type: f.type || "" });
    } catch (e) {
      setBanner(`${L.uploadFailed}${e instanceof Error ? `: ${e.message}` : ""}`);
    } finally {
      setUploading(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const download = () => {
    const lines = entriesRef.current.map((e) => {
      const head = `[${fmtTime(e.ts)}] ${e.name} (${e.lang})`;
      const body = e.kind === "file" && e.file
        ? `[${L.fileTag}] ${e.file.name} ${new URL(e.file.url, window.location.origin).href}`
        : `${e.kind === "chat" ? `[${L.chatTag}] ` : ""}${e.mine || e.lang === lang ? e.original : `${e.translated ?? ""}\n    原文: ${e.original}`}`;
      return `${head}\n    ${body}`;
    });
    const blob = new Blob([`Agora ${room} ${new Date().toLocaleString()}\n\n${lines.join("\n\n")}\n`], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `agora-${room}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const anySharing = sharing || peers.some((p) => p.sharing);
  const count = peers.length + 1;
  const myUid = uidRef.current;
  const initial = (s: string) => (s || "?").slice(0, 1).toUpperCase();

  return (
    <main className="room">
      <section className="stage">
        <div className={`grid n${Math.min(count, 4)}${anySharing ? " has-share" : ""}`}>
          <div className={`tile${sharing ? " sharing" : ""}${speaking.has(myUid) && micOn ? " talking" : ""}`} style={{ ["--c" as string]: colorOf(myUid) }}>
            {(!hasCam || !camOn) && !sharing && <div className="ph"><b>{initial(name)}</b></div>}
            <div className="vid" ref={localEl} style={{ visibility: (hasCam && camOn) || sharing ? "visible" : "hidden" }} />
            <span className="who">{name}（{L.you}）{!micOn && " · 🔇"}</span>
          </div>
          {peers.map((p) => (
            <div key={p.uid} className={`tile${p.sharing ? " sharing" : ""}${speaking.has(p.uid) ? " talking" : ""}`} style={{ ["--c" as string]: colorOf(p.uid) }}>
              <div className="ph"><b>{initial(p.name)}</b></div>
              <div className="vid" id={`tile-${p.uid}`} />
              <span className="who">{p.name || "…"}</span>
            </div>
          ))}
        </div>
        {peers.length === 0 && <p className="waiting">{L.waiting}</p>}
        {captions.length > 0 && (
          <div className="captions" aria-live="polite">
            {captions.map((c) => (
              <div key={c.id} className="caption">
                <small style={{ color: colorOf(c.uid) }}>{c.name}</small>
                {c.pending ? L.translating : c.translated}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="bar">
        {banner && <div className="banner" role="alert">{banner}</div>}
        {!srSupported && <div className="banner" role="alert">{L.noSr}</div>}
        <button className={`ctl${micOn ? "" : " off"}`} onClick={toggleMic} aria-pressed={micOn}>{L.mic}</button>
        <button className={`ctl${camOn && hasCam ? "" : " off"}`} onClick={toggleCam} disabled={!hasCam || sharing} aria-pressed={camOn}>{L.cam}</button>
        <button className={`ctl${sharing ? " on" : ""}`} onClick={sharing ? stopShare : startShare}>{sharing ? L.stopShare : L.share}</button>
        <button className="ctl" onClick={copyLink}>{copied ? L.copied : L.copyLink}</button>
        <button className="ctl leave" onClick={onLeave}>{L.leave}</button>
      </div>

      <aside className="side">
        <div className="side-head">
          <h2>{L.log}</h2>
          <button className="ghost" onClick={download} disabled={!entries.length}>{L.download}</button>
        </div>
        <div className="log">
          {entries.length === 0 && <p className="log-empty">{L.emptyLog}</p>}
          {entries.map((e) => (
            <div key={e.id} className={`entry${e.mine ? " mine" : ""}`} style={{ ["--c" as string]: colorOf(e.uid) }}>
              <div className="meta">
                <b style={{ color: colorOf(e.uid) }}>{e.mine ? L.you : e.name}</b>
                <span>{fmtTime(e.ts)}</span>
                {e.kind === "chat" && <span className="tag">{L.chatTag}</span>}
              </div>
              {e.kind === "file" && e.file ? (
                <a className="file" href={e.file.url} target="_blank" rel="noreferrer">
                  {e.file.type.startsWith("image/") && <img src={e.file.url} alt="" />}
                  <span className="fname">📎 {e.file.name}</span>
                  <span className="fsize">{fmtSize(e.file.size)}</span>
                </a>
              ) : e.mine || e.lang === lang ? (
                <div className="main">{e.original}</div>
              ) : (
                <>
                  <div className={`main${e.pending ? " pending" : ""}`}>{e.pending ? L.translating : e.translated}</div>
                  <div className="orig">{e.original}</div>
                </>
              )}
            </div>
          ))}
          <div ref={logEnd} />
        </div>
        <div className="interim">
          {micOn ? (<><i />{interim || L.listening}</>) : L.micOff}
        </div>
        <div className="composer">
          <input
            ref={fileInput}
            type="file"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); }}
          />
          <button className="clip" onClick={() => fileInput.current?.click()} disabled={!!uploading} aria-label={L.attach} title={L.attach}>📎</button>
          <textarea
            className="chat-input"
            rows={1}
            value={draft}
            placeholder={uploading ? `${L.uploading} ${uploading}` : L.chatPlaceholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // 日本語変換中のEnterでは送らない
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                sendChat();
              }
            }}
          />
          <button className="send" onClick={sendChat} disabled={!draft.trim()}>{L.send}</button>
        </div>
      </aside>
    </main>
  );
}
