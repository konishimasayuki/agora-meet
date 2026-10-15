export type Lang = "ja" | "tr" | "en";

export const LANGS: { code: Lang; label: string; sr: string }[] = [
  { code: "ja", label: "日本語", sr: "ja-JP" },
  { code: "tr", label: "Türkçe", sr: "tr-TR" },
  { code: "en", label: "English", sr: "en-US" },
];

const dict = {
  ja: {
    tagline: "話した言葉が、相手の言語で字幕になるビデオ会議",
    roomName: "ルーム名",
    createRoom: "ルームを作る",
    yourName: "お名前",
    yourLang: "あなたが話す言語",
    join: "参加する",
    joining: "接続中…",
    mic: "マイク",
    cam: "カメラ",
    share: "画面共有",
    stopShare: "共有を停止",
    leave: "退出",
    log: "会話ログ",
    download: "ログを保存",
    copyLink: "招待リンクをコピー",
    copied: "コピーしました",
    emptyLog: "話し始めると、ここに原文と翻訳が表示されます。",
    listening: "聞き取り中",
    micOff: "マイクがオフです",
    noSr: "このブラウザは音声認識に対応していません。パソコンのGoogle Chromeで開いてください。",
    noShare: "この端末は画面共有に対応していません。パソコンのChromeから共有してください。",
    translating: "翻訳中…",
    waiting: "相手の参加を待っています",
    you: "あなた",
    left: "退出しました",
    rejoin: "もう一度参加する",
    tip: "一文ずつ区切って話すと、翻訳が正確になります。",
  },
  tr: {
    tagline: "Konuştuğunuz sözler karşı tarafın dilinde altyazı olur",
    roomName: "Oda adı",
    createRoom: "Oda oluştur",
    yourName: "Adınız",
    yourLang: "Konuşacağınız dil",
    join: "Katıl",
    joining: "Bağlanıyor…",
    mic: "Mikrofon",
    cam: "Kamera",
    share: "Ekran paylaş",
    stopShare: "Paylaşımı durdur",
    leave: "Ayrıl",
    log: "Konuşma kaydı",
    download: "Kaydı indir",
    copyLink: "Davet linkini kopyala",
    copied: "Kopyalandı",
    emptyLog: "Konuşmaya başladığınızda orijinal metin ve çeviri burada görünür.",
    listening: "Dinleniyor",
    micOff: "Mikrofon kapalı",
    noSr: "Bu tarayıcı ses tanımayı desteklemiyor. Lütfen bilgisayarda Google Chrome ile açın.",
    noShare: "Bu cihaz ekran paylaşımını desteklemiyor. Lütfen bilgisayardan Chrome ile paylaşın.",
    translating: "Çevriliyor…",
    waiting: "Diğer katılımcı bekleniyor",
    you: "Siz",
    left: "Toplantıdan ayrıldınız",
    rejoin: "Tekrar katıl",
    tip: "Cümle cümle konuşursanız çeviri daha doğru olur.",
  },
  en: {
    tagline: "Video meetings where your words become captions in their language",
    roomName: "Room name",
    createRoom: "Create room",
    yourName: "Your name",
    yourLang: "Language you speak",
    join: "Join",
    joining: "Connecting…",
    mic: "Mic",
    cam: "Camera",
    share: "Share screen",
    stopShare: "Stop sharing",
    leave: "Leave",
    log: "Conversation",
    download: "Save log",
    copyLink: "Copy invite link",
    copied: "Copied",
    emptyLog: "When someone speaks, the original and translation appear here.",
    listening: "Listening",
    micOff: "Mic is off",
    noSr: "This browser does not support speech recognition. Please open it in Google Chrome on a computer.",
    noShare: "This device cannot share its screen. Please share from Chrome on a computer.",
    translating: "Translating…",
    waiting: "Waiting for others to join",
    you: "You",
    left: "You left the meeting",
    rejoin: "Join again",
    tip: "Speaking one sentence at a time gives more accurate translations.",
  },
};

export type Dict = (typeof dict)["ja"];
export const t = (lang: Lang): Dict => dict[lang];

export function guessLang(): Lang {
  if (typeof navigator === "undefined") return "ja";
  const l = navigator.language.toLowerCase();
  if (l.startsWith("tr")) return "tr";
  if (l.startsWith("ja")) return "ja";
  return "en";
}
