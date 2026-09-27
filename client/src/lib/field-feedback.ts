export type FieldCue = "ping" | "urgent" | "success" | "alert" | "route" | "tap" | "countdown";

let fieldAudio: AudioContext | null = null;
let pendingCue: FieldCue | null = null;

function getContext() {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return null;
  fieldAudio ??= new window.AudioContext();
  return fieldAudio;
}

/**
 * Mobile browsers permit sound only after a direct player gesture. Call this from a visible
 * button (ready, enable sound, map control) and retain the unlocked context for game events.
 */
export async function unlockFieldAudio() {
  const context = getContext();
  if (!context) return false;
  try {
    if (context.state !== "running") await context.resume();
    if (context.state !== "running") return false;
    // A near-silent oscillator confirms the output path while the click is still user initiated.
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.00001, context.currentTime);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.015);
    if (pendingCue) {
      const cue = pendingCue;
      pendingCue = null;
      window.setTimeout(() => playFieldCue(cue), 20);
    }
    return true;
  } catch {
    return false;
  }
}

export function fieldAudioEnabled() {
  return fieldAudio?.state === "running";
}

export function playFieldCue(cue: FieldCue) {
  const context = getContext();
  if (!context || context.state !== "running") {
    pendingCue = cue;
    return false;
  }

  const patterns: Record<FieldCue, { notes: number[]; interval: number; wave: OscillatorType; volume: number }> = {
    tap: { notes: [620], interval: 0.08, wave: "sine", volume: 0.055 },
    ping: { notes: [740, 880], interval: 0.13, wave: "sine", volume: 0.11 },
    countdown: { notes: [880], interval: 0.1, wave: "square", volume: 0.08 },
    route: { notes: [440, 554, 660], interval: 0.09, wave: "triangle", volume: 0.1 },
    success: { notes: [523, 659, 784], interval: 0.12, wave: "sine", volume: 0.13 },
    urgent: { notes: [980, 760, 980], interval: 0.12, wave: "square", volume: 0.15 },
    alert: { notes: [360, 300, 360], interval: 0.14, wave: "sawtooth", volume: 0.1 },
  };

  const pattern = patterns[cue];
  pattern.notes.forEach((frequency, index) => {
    const start = context.currentTime + index * pattern.interval;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = pattern.wave;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(pattern.volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.07, pattern.interval - 0.01));
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + Math.max(0.09, pattern.interval));
  });
  return true;
}

export function fieldHaptic(pattern: number | number[] = 18) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
}
