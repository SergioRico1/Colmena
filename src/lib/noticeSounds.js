// The two notice sounds (T3 Code threadNotifications: one for «completion», one for «input»),
// drawn with Web Audio so no file ships: «ha terminado» is a soft rising pair of notes,
// «te necesita» a brighter two-tone call heard twice. Played when the desktop shell says so
// (Ajustes › Avisos › Cómo te avisa) and by «Probar» in Ajustes.

let context = null;
const playingUntil = new Map(); // kind → audio clock time its current playback ends

const NOTES = {
  // [frequency Hz, start s, length s, gain]
  done: [[659.25, 0, 0.42, 0.16], [987.77, 0.13, 0.6, 0.13]],
  needs: [[880, 0, 0.2, 0.17], [1174.66, 0.16, 0.26, 0.15], [880, 0.52, 0.2, 0.15], [1174.66, 0.68, 0.34, 0.14]],
};

function audio() {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  context ||= new Ctx();
  return context;
}

/** Plays «done» or «needs». Rooms that finish together sound once (one playback per burst). */
export async function playNoticeSound(kind) {
  const ctx = audio();
  if (!ctx) return;
  try { if (ctx.state !== "running") await ctx.resume(); } catch {}
  if (ctx.state !== "running") return;
  const notes = NOTES[kind] || NOTES.done;
  if (ctx.currentTime < (playingUntil.get(kind) || 0)) return;
  const start = ctx.currentTime + 0.02;
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(ctx.destination);
  let end = start;
  for (const [freq, at, length, gain] of notes) {
    const t = start + at;
    for (const [mult, share] of [[1, 1], [2, 0.18]]) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq * mult;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(gain * share, t + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, t + length);
      osc.connect(env).connect(out);
      osc.start(t);
      osc.stop(t + length + 0.05);
    }
    end = Math.max(end, t + length);
  }
  playingUntil.set(kind, end);
}

/** Desktop app: the main process asks for a sound with each notice that has one. */
export function listenForNoticeSounds() {
  const bridge = typeof window !== "undefined" ? window.colmenaWindow : null;
  if (typeof bridge?.onSound !== "function") return () => {};
  return bridge.onSound((kind) => { void playNoticeSound(kind); });
}
