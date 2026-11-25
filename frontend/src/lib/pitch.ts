/** Real-time pitch detection in the browser (YIN, cumulative mean normalised difference).
 *  Runs on every animation frame against the mic AnalyserNode, so the live
 *  pitch trail has zero network latency. */

export function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

const scratch = { d: new Float32Array(0) };

export function detectPitch(buf: Float32Array, sampleRate: number, fmin = 65, fmax = 500, gate = 0.008): number | null {
  if (rms(buf) < gate) return null;
  const tauMin = Math.floor(sampleRate / fmax);
  const tauMax = Math.min(Math.floor(sampleRate / fmin), Math.floor(buf.length / 2));
  const W = buf.length - tauMax;
  if (scratch.d.length < tauMax + 1) scratch.d = new Float32Array(tauMax + 1);
  const d = scratch.d;

  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < W; i++) {
      const diff = buf[i] - buf[i + tau];
      sum += diff * diff;
    }
    running += sum;
    d[tau] = running > 0 ? (sum * tau) / running : 1;
  }

  const threshold = 0.15;
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;

  // parabolic interpolation around the minimum
  const x0 = tau > 1 ? d[tau - 1] : d[tau];
  const x2 = tau + 1 <= tauMax ? d[tau + 1] : d[tau];
  const denom = 2 * (2 * d[tau] - x2 - x0);
  const better = denom !== 0 ? tau + (x2 - x0) / denom : tau;
  const f = sampleRate / better;
  return f >= fmin && f <= fmax ? f : null;
}

export const semitones = (f: number, ref: number) => 12 * Math.log2(f / ref);

const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export function noteName(f: number): string {
  const n = Math.round(12 * Math.log2(f / 440) + 69);
  return `${NOTES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

/** Slope (semitones/sec) of the most recent `windowS` seconds of voiced samples. */
export function recentSlope(samples: { t: number; f: number | null }[], windowS = 0.5): number | null {
  if (!samples.length) return null;
  const tEnd = samples[samples.length - 1].t;
  const pts = samples.filter((s) => s.f !== null && s.t >= tEnd - windowS) as { t: number; f: number }[];
  if (pts.length < 6) return null;
  const ref = pts[0].f;
  const xs = pts.map((p) => p.t), ys = pts.map((p) => semitones(p.f, ref));
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den > 0 ? num / den : null;
}
