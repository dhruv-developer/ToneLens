import { useEffect, useRef, type MutableRefObject } from "react";
import type { LiveSample } from "../hooks/useRecorder";

const WINDOW_S = 6;
const F_LO = 70, F_HI = 420;

/** Scrolling real-time pitch trail with a glowing head and a level floor. */
export function LivePitchCanvas({ samples, active, height = 220 }: {
  samples: MutableRefObject<LiveSample[]>; active: boolean; height?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d")!;
    let raf = 0;

    const yOf = (f: number, h: number) => {
      const v = Math.log2(f / F_LO) / Math.log2(F_HI / F_LO);
      return h - 24 - v * (h - 48);
    };

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth, h = el.clientHeight;
      if (el.width !== w * dpr || el.height !== h * dpr) {
        el.width = w * dpr;
        el.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // semitone grid (octaves bold)
      for (let f = 80; f <= F_HI; f *= 2 ** (1 / 4)) {
        const y = yOf(f, h);
        ctx.strokeStyle = "rgba(255,255,255,0.035)";
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(154,162,192,0.45)";
      ctx.font = "10px JetBrains Mono, monospace";
      [100, 200, 400].forEach((f) => ctx.fillText(`${f} Hz`, 6, yOf(f, h) - 3));

      const s = samples.current;
      if (s.length) {
        const tEnd = s[s.length - 1].t;
        const xOf = (t: number) => w - ((tEnd - t) / WINDOW_S) * w;

        // level floor
        for (const p of s) {
          if (p.t < tEnd - WINDOW_S) continue;
          const bh = Math.min(1, p.level * 6) * 40;
          ctx.fillStyle = "rgba(47,214,176,0.18)";
          ctx.fillRect(xOf(p.t), h - bh, 2, bh);
        }

        // pitch trail
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, "rgba(139,123,255,0)");
        grad.addColorStop(0.5, "rgba(139,123,255,0.8)");
        grad.addColorStop(1, "#c4bbff");
        ctx.strokeStyle = grad;
        ctx.shadowColor = "rgba(139,123,255,0.8)";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        let pen = false, prevF: number | null = null;
        for (const p of s) {
          if (p.t < tEnd - WINDOW_S || p.f === null || (prevF && Math.abs(Math.log2(p.f / prevF)) > 0.35)) {
            pen = false;
            prevF = p.f;
            continue;
          }
          const x = xOf(p.t), y = yOf(p.f, h);
          if (pen) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          pen = true;
          prevF = p.f;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        const last = s[s.length - 1];
        if (last.f) {
          const y = yOf(last.f, h);
          ctx.fillStyle = "#fff";
          ctx.shadowColor = "#8b7bff";
          ctx.shadowBlur = 20;
          ctx.beginPath();
          ctx.arc(w - 4, y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      if (active) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [samples, active]);

  return <canvas ref={canvas} className="w-full" style={{ height }} />;
}
