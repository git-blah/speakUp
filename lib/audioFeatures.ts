/**
 * Prosody from the recorded audio: loudness, voice activity and pitch. Pure functions on mono
 * samples so they can be tested with synthetic signals; decodeAudio() is the browser-only wrapper.
 *
 * Pitch uses YIN on 8 kHz audio, which is plenty for speaking voices (75–400 Hz) and fast enough
 * to run on a minute of speech in well under a second. Checked against a real recording (JFK's
 * "ask not" clip): YIN's median agreed with an independent harmonic-product-spectrum estimate,
 * and the speech/pause segmentation matched the audible pauses.
 */

export const ANALYSIS_RATE = 8000;
const FRAME = 320; // 40 ms at 8 kHz
const HOP = 160; // 20 ms
const MIN_F0 = 75;
const MAX_F0 = 400;
/** YIN threshold: lower is stricter about calling a frame voiced. */
const YIN_THRESHOLD = 0.15;
/** A frame is speech if it's this many dB above the recording's noise floor. */
const SPEECH_ABOVE_FLOOR_DB = 12;
/** Silences at least this long split speech into runs. */
const RUN_GAP_S = 0.7;

export interface AudioFeatures {
  seconds: number;
  /** Share of the recording with speech. */
  speechShare: number;
  /** Median pitch of voiced frames (Hz). */
  pitchMedianHz: number | null;
  /** Spread of pitch: standard deviation and 10th–90th percentile range, in semitones. */
  pitchStdSt: number | null;
  pitchRangeSt: number | null;
  /** Standard deviation of loudness across speech frames (dB). */
  loudnessStdDb: number | null;
  /** How much quieter the last 0.3 s before each pause is than the run's average (dB, positive = quieter). */
  phraseEndDropDb: number | null;
  /** Continuous speech between silences of RUN_GAP_S or more. */
  runs: { start: number; end: number }[];
  /** Mean length of those runs (s). */
  meanRunS: number | null;
  voicedFrames: number;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
}

function std(values: number[]): number {
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length);
}

/**
 * Pitch of one frame with YIN (de Cheveigné & Kawahara, 2002), or null if unvoiced. YIN picks the
 * first period whose normalised difference dips below a threshold, which avoids the octave errors
 * (half or double the true pitch) that plain autocorrelation makes on real voices.
 */
export function framePitch(frame: Float32Array, rate = ANALYSIS_RATE): number | null {
  const minLag = Math.floor(rate / MAX_F0);
  const maxLag = Math.ceil(rate / MIN_F0);
  const w = frame.length - maxLag;
  if (w < minLag * 2) return null;

  const d = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < w; i++) {
      const diff = frame[i] - frame[i + lag];
      sum += diff * diff;
    }
    d[lag] = sum;
  }
  // Cumulative mean normalised difference.
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    running += d[lag];
    cmnd[lag] = running > 0 ? (d[lag] * lag) / running : 1;
  }

  let lag = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (cmnd[t] < YIN_THRESHOLD) {
      while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++;
      lag = t;
      break;
    }
  }
  // At the edges of the search range the "pitch" is really out of range (or not a voice).
  if (lag <= minLag || lag >= maxLag) return null;

  // Parabolic interpolation around the dip for sub-sample precision.
  const a = cmnd[lag - 1];
  const b = cmnd[lag];
  const c = cmnd[lag + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  return rate / (lag + Math.max(-0.5, Math.min(0.5, shift)));
}

/** Analyse mono samples already at ANALYSIS_RATE. */
export function analyzeAudio(samples: Float32Array, rate = ANALYSIS_RATE): AudioFeatures | null {
  const frames = Math.floor((samples.length - FRAME) / HOP) + 1;
  if (frames < 25) return null; // under half a second

  const db: number[] = [];
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = samples[f * HOP + i];
      sum += v * v;
    }
    db.push(10 * Math.log10(sum / FRAME + 1e-10));
  }
  // Speech = clearly above the noise floor AND within 30 dB of the loudest speech, so near-silent
  // frames (breaths, digital silence, room tone) never count. If there is almost no silence the
  // floor sits at speech level, so the threshold is also capped 6 dB below the loud frames.
  const sortedDb = [...db].sort((a, b) => a - b);
  const loud = percentile(sortedDb, 0.95);
  const threshold = Math.min(Math.max(percentile(sortedDb, 0.1) + SPEECH_ABOVE_FLOOR_DB, loud - 30), loud - 6);
  const speech = db.map((d) => d > threshold);
  const t = (f: number) => (f * HOP + FRAME / 2) / rate;

  // Speech runs separated by long silences (short gaps inside words/phrases are bridged).
  const gapFrames = Math.round((RUN_GAP_S * rate) / HOP);
  const runs: { start: number; end: number; first: number; last: number }[] = [];
  let runStart = -1;
  let lastSpeech = -1;
  for (let f = 0; f < frames; f++) {
    if (!speech[f]) continue;
    if (runStart < 0) runStart = f;
    else if (f - lastSpeech > gapFrames) {
      runs.push({ start: t(runStart), end: t(lastSpeech), first: runStart, last: lastSpeech });
      runStart = f;
    }
    lastSpeech = f;
  }
  if (runStart >= 0) runs.push({ start: t(runStart), end: t(lastSpeech), first: runStart, last: lastSpeech });

  const speechDb = db.filter((_, f) => speech[f]);
  const pitches: number[] = [];
  for (let f = 0; f < frames; f++) {
    if (!speech[f]) continue;
    const p = framePitch(samples.subarray(f * HOP, f * HOP + FRAME), rate);
    if (p !== null) pitches.push(p);
  }

  // End-of-phrase drop: last 0.3 s of each run (that is followed by a pause) vs the whole run.
  const tailFrames = Math.round((0.3 * rate) / HOP);
  const drops: number[] = [];
  for (const r of runs.slice(0, -1)) {
    if (r.last - r.first < tailFrames * 3) continue;
    const runDb = db.slice(r.first, r.last + 1).filter((_, i) => speech[r.first + i]);
    const tailDb = db.slice(r.last - tailFrames + 1, r.last + 1).filter((_, i) => speech[r.last - tailFrames + 1 + i]);
    if (runDb.length && tailDb.length) {
      const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      drops.push(mean(runDb) - mean(tailDb));
    }
  }

  let pitchStdSt: number | null = null;
  let pitchRangeSt: number | null = null;
  let pitchMedianHz: number | null = null;
  if (pitches.length >= 30) {
    const sorted = [...pitches].sort((a, b) => a - b);
    pitchMedianHz = percentile(sorted, 0.5);
    // Spread of the middle 90% only, so a few stray estimates can't inflate it.
    const st = sorted.slice(Math.floor(sorted.length * 0.05), Math.ceil(sorted.length * 0.95)).map((p) => 12 * Math.log2(p / pitchMedianHz!));
    pitchStdSt = std(st);
    pitchRangeSt = 12 * Math.log2(percentile(sorted, 0.9) / percentile(sorted, 0.1));
  }

  return {
    seconds: samples.length / rate,
    speechShare: speechDb.length / frames,
    pitchMedianHz,
    pitchStdSt,
    pitchRangeSt,
    loudnessStdDb: speechDb.length >= 25 ? std(speechDb) : null,
    phraseEndDropDb: drops.length >= 2 ? drops.reduce((a, b) => a + b, 0) / drops.length : null,
    runs: runs.map(({ start, end }) => ({ start, end })),
    meanRunS: runs.length ? runs.reduce((a, r) => a + (r.end - r.start), 0) / runs.length : null,
    voicedFrames: pitches.length,
  };
}

/** Decode a recording (browser only) to mono samples at ANALYSIS_RATE and analyse it. */
export async function analyzeRecording(blob: Blob): Promise<AudioFeatures | null> {
  const bytes = await blob.arrayBuffer();
  // Decode at the source rate, then resample to 8 kHz with an offline context (it low-pass filters).
  const probe = new OfflineAudioContext(1, 1, 44100);
  const decoded = await probe.decodeAudioData(bytes);
  const length = Math.ceil(decoded.duration * ANALYSIS_RATE);
  if (length < FRAME * 2) return null;
  const ctx = new OfflineAudioContext(1, length, ANALYSIS_RATE);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return analyzeAudio(rendered.getChannelData(0), ANALYSIS_RATE);
}
