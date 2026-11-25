import clsx from "clsx";
import type { Player } from "../hooks/usePlayer";
import type { Features } from "../lib/types";

/** Transcript where each word's background encodes its speaker-relative emphasis. */
export function Transcript({ features, text, player }: { features: Features | null; text: string | null; player: Player }) {
  const words = features?.words ?? [];
  if (!words.length) {
    return <p className="text-2xl leading-relaxed text-ink-200">{text || <span className="text-ink-400">(no speech detected)</span>}</p>;
  }
  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-3 text-2xl leading-relaxed md:text-[28px]">
        {words.map((w, i) => {
          const a = Math.max(0, Math.min(1, w.emphasis_score / 2));
          const active = player.t >= w.start && player.t <= w.end && player.playing;
          return (
            <span key={i} className="contents">
              {w.pause_before >= 0.25 && (
                <span className="mx-1 inline-flex items-center gap-1 self-center rounded-full border border-pause/30 bg-pause/10 px-2 py-0.5 font-mono text-xs text-pause">
                  ‖ {w.pause_before.toFixed(1)}s
                </span>
              )}
              <button type="button" onClick={() => player.playRange(w.start, w.end)}
                title={`emphasis ${w.emphasis_score.toFixed(2)} · ${Object.entries(w.z).map(([k, v]) => `${k} z=${v}`).join(", ") || "no spread"}`}
                className={clsx("rounded-lg px-1.5 py-0.5 transition hover:ring-1 hover:ring-white/30",
                  w.emphasis_candidate && "font-bold underline decoration-emph decoration-2 underline-offset-[6px]",
                  w.is_filler && "italic text-ink-400",
                  active && "ring-2 ring-white")}
                style={{ background: w.emphasis_candidate ? `rgba(255,181,71,${0.18 + a * 0.35})` : a > 0.05 ? `rgba(139,123,255,${a * 0.35})` : undefined }}>
                {w.word}
              </button>
            </span>
          );
        })}
      </p>
      <p className="mt-4 text-xs text-ink-400">
        Click any word to hear it. Shading shows how much a word stands out in pitch, loudness or lengthening <em>relative to this speaker</em>; underlined words are emphasis candidates; ‖ marks pauses ≥ 250 ms.
      </p>
    </div>
  );
}
