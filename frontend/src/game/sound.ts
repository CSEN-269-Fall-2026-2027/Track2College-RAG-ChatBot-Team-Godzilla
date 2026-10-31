/**
 * Tiny synthesized sound effects (no audio files): per-character typing blips
 * and a selection chime. Browsers only allow audio after a user gesture, so the
 * context is created lazily on first use.
 */
let context: AudioContext | null = null;
let lastBlip = 0;

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

function tone(frequency: number, start: number, duration: number, volume: number, type: OscillatorType = "square") {
  const ctx = audio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  const t = ctx.currentTime + start;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

/** One "voice" blip; throttled so fast typing doesn't turn into a buzz. */
export function blip(baseFrequency: number) {
  const now = performance.now();
  if (now - lastBlip < 55) return;
  lastBlip = now;
  tone(baseFrequency * (0.92 + Math.random() * 0.16), 0, 0.045, 0.035);
}

export function chime(kind: "select") {
  const notes: Record<typeof kind, number[]> = { select: [660] };
  notes[kind].forEach((f, i) => tone(f, i * 0.085, 0.18, 0.05, "triangle"));
}

// ---------------------------------------------------------------------------
// Optional read-aloud via the Web Speech API.
// ---------------------------------------------------------------------------

export const speechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

export function speak(text: string, pitch: number) {
  if (!speechSupported()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.pitch = pitch;
  utterance.rate = 1.04;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (speechSupported()) window.speechSynthesis.cancel();
}
