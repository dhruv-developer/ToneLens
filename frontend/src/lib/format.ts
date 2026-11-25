export const fmt = (v: number | null | undefined, digits = 1, unit = "") =>
  v === null || v === undefined || Number.isNaN(v) ? "–" : `${v.toFixed(digits)}${unit}`;

export const pct = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined ? "–" : `${(v * 100).toFixed(digits)}%`;

export const signed = (v: number | null | undefined, digits = 1, unit = "") =>
  v === null || v === undefined ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}${unit}`;

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const LANGS: Record<string, string> = {
  en: "English", hi: "Hindi", ur: "Urdu", bn: "Bengali", ta: "Tamil", te: "Telugu", mr: "Marathi", gu: "Gujarati",
  pa: "Punjabi", es: "Spanish", fr: "French", de: "German", ja: "Japanese", zh: "Chinese", ar: "Arabic",
};
export const langName = (code: string | null | undefined) => (code ? LANGS[code] ?? code.toUpperCase() : "–");

export const SERIES = ["#8b7bff", "#2fd6b0", "#ffb547", "#ff6b8a", "#5cc8ff", "#d68bff"];

export const STAGES = [
  { key: "queued", label: "Queued" },
  { key: "decoding", label: "Decoding audio" },
  { key: "transcribing", label: "Transcribing speech" },
  { key: "measuring", label: "Measuring prosody" },
  { key: "fingerprinting", label: "Fingerprinting delivery" },
  { key: "done", label: "Ready" },
];
