export type Status = "queued" | "processing" | "done" | "failed";
export type Kind = "analysis" | "baseline" | "drill";
export type SpeechAct = "statement" | "question" | "request" | "exclamation" | "unclear";
export type Mode = "prosody" | "text_only";

export interface WordFeat {
  word: string;
  start: number;
  end: number;
  pitch_st: number | null;
  energy_db: number | null;
  dur_per_char: number | null;
  pause_before: number;
  is_filler: boolean;
  emphasis_score: number;
  z: Record<string, number>;
  emphasis_candidate: boolean;
}

export interface Pause { start: number; end: number; duration: number }

export interface BaselineRelative {
  baseline_recordings: number;
  pitch_level_st?: number;
  pitch_range_delta_st?: number;
  rate_ratio?: number;
  loudness_delta_db?: number;
  pause_ratio_delta?: number;
}

export interface Features {
  duration_seconds: number;
  pitch_median_hz: number | null;
  pitch_p10_hz: number | null;
  pitch_p90_hz: number | null;
  pitch_range_semitones: number | null;
  pitch_variability_semitones: number | null;
  final_contour_slope_st_per_s: number | null;
  final_contour: "rising" | "falling" | "level" | "unknown";
  energy_mean: number;
  energy_variability: number;
  pause_ratio: number;
  active_speech_ratio: number;
  pauses: Pause[];
  long_pause_count: number;
  speaking_rate_wps: number;
  word_count: number;
  voiced_frame_ratio: number;
  fillers: string[];
  words: WordFeat[];
  emphasis_candidates: string[];
  curves: { time: number[]; rms: number[]; pitch_hz: (number | null)[]; threshold: number };
  baseline_relative?: BaselineRelative;
  warning?: string;
}

export interface FingerprintDim { key: string; label: string; value: number | null; raw: number | null }
export interface Fingerprint { dims: FingerprintDim[]; vector: number[]; speaker_relative: boolean }

export interface InterpretationAnalysis {
  literal_meaning: string;
  vocal_delivery: string;
  interpretations: { hypothesis: string; confidence: "low" | "medium" | "high"; evidence: string }[];
  emphasized_words: string[];
  hesitation: string;
  prosody_text_agreement: "consistent" | "divergent" | "insufficient";
  agreement_reason: string;
  speech_act: SpeechAct;
  cannot_infer: string[];
}

export interface Interpretation {
  mode: Mode;
  analysis: InterpretationAnalysis | null;
  raw: string;
  error: string | null;
}

export interface Contours { pitch: number[]; energy: number[]; voiced: boolean[] }

export interface DrillResult {
  overall: number;
  parts: Record<"contour" | "energy" | "pace" | "range" | "emphasis", number | null>;
  tips: string[];
  contours: { reference: Contours; attempt: Contours };
}

export interface AnalysisSummary {
  id: string;
  kind: Kind;
  status: Status;
  stage: string;
  progress: number;
  error: string | null;
  title: string | null;
  filename: string;
  created_at: string;
  duration: number | null;
  language: string | null;
  transcript: string | null;
  tags: string[];
  label: SpeechAct | null;
  profile_id: string | null;
  reference_id: string | null;
  model_size: string;
  headline: {
    pitch_median_hz: number | null;
    pitch_range_semitones: number | null;
    final_contour: string;
    pause_ratio: number;
    speaking_rate_wps: number;
    emphasis_candidates: string[];
  } | null;
  fingerprint: number[] | null;
  interpreted: Mode[];
  drill_score: number | null;
}

export interface Analysis extends AnalysisSummary {
  context: string;
  language_probability: number | null;
  asr: { text: string; language: string; words: { word: string; start: number; end: number; probability: number }[] } | null;
  features: Features | null;
  fingerprint_detail: Fingerprint | null;
  interpretations: Partial<Record<Mode, Interpretation>>;
  drill: DrillResult | null;
  audio_url: string | null;
}

export interface Profile {
  id: string;
  name: string;
  created_at: string;
  baseline: {
    n: number;
    pitch_median_hz?: number;
    pitch_range_semitones?: number;
    speaking_rate_wps?: number;
    energy_mean?: number;
    pause_ratio?: number;
  } | null;
}

export interface AppConfig {
  groq_configured: boolean;
  whisper_models: string[];
  default_model: string;
  queue: "inline" | "redis";
  workers: number;
  max_upload_mb: number;
  max_duration_s: number;
  fingerprint_dims: { key: string; label: string }[];
}

export interface Stats {
  by_status: Partial<Record<Status, number>>;
  by_language: Record<string, number>;
  audio_seconds: number;
  profiles: number;
  queue_depth: number;
}

export interface CompareItem extends AnalysisSummary {
  fingerprint_detail: Fingerprint;
  contours: Contours;
  features: Omit<Features, "curves">;
}

export interface Evaluation {
  overall: { n: number; text_only_acc: number | null; prosody_acc: number | null; prosody_only_correct: number; text_only_correct: number };
  by_language: Record<string, { n: number; text_only_acc: number | null; prosody_acc: number | null }>;
  items: (AnalysisSummary & { pred_text_only: SpeechAct | null; pred_prosody: SpeechAct | null })[];
  labeled: number;
  groq_configured: boolean;
}
