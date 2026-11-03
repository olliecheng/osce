/* Ported from the original single-file page (including the Safari workarounds), plus a
   clock check: Safari can report "running" while output is dead, so we verify the context's
   clock advances and otherwise rebuild it and fall back to <audio>. */
let actx: AudioContext | null = null;
try {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) nav.audioSession.type = "playback";
} catch {}
function audio() {
  if (!actx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      actx = new AC();
    } catch (_e) {
      return null;
    }
  }
  if (actx.state !== "running") actx.resume().catch(() => {});
  return actx;
}
// Safari can leave a context silently broken (after sleep, output change, etc.),
// so every click that needs sound replaces it with a new one.
export function freshAudio() {
  stopKeepAlive();
  if (actx) {
    try {
      actx.close();
    } catch {}
    actx = null;
  }
  return audio();
}
// Contexts whose clock has been seen advancing / seen frozen despite state "running".
let healthy: AudioContext | null = null;
let broken: AudioContext | null = null;
function verifyOrFallback(ctx: AudioContext, times: number) {
  const t0 = ctx.currentTime;
  setTimeout(() => {
    if (ctx.currentTime > t0) {
      if (ctx === actx) healthy = ctx;
      return;
    }
    if (healthy === ctx) healthy = null;
    broken = ctx;
    playFallback(times);
  }, 150);
}
let keepAlive: { o: OscillatorNode; g: GainNode } | null = null;
export function startKeepAlive() {
  if (!actx || keepAlive) return;
  try {
    const o = actx.createOscillator(),
      g = actx.createGain();
    o.frequency.value = 40;
    g.gain.value = 0.00001; // inaudible; stops Safari idling the context
    o.connect(g).connect(actx.destination);
    o.start();
    keepAlive = { o, g };
  } catch {}
}
export function stopKeepAlive() {
  if (!keepAlive) return;
  try {
    keepAlive.o.stop();
    keepAlive.o.disconnect();
    keepAlive.g.disconnect();
  } catch {}
  keepAlive = null;
}
// Any tap or keypress revives a context the browser has suspended or interrupted.
["pointerdown", "keydown", "touchend"].forEach((ev) =>
  document.addEventListener(
    ev,
    () => {
      if (actx && actx.state !== "running") actx.resume().catch(() => {});
    },
    { capture: true, passive: true },
  ),
);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && actx && actx.state !== "running")
    actx.resume().catch(() => {});
});
const buses = new WeakMap<BaseAudioContext, GainNode>();
function busFor(ctx: BaseAudioContext) {
  let out = buses.get(ctx);
  if (!out) {
    out = ctx.createGain();
    out.gain.value = 0.32;
    out.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
    buses.set(ctx, out);
  }
  return out;
}
function strike(ctx: BaseAudioContext, t0: number, base: number) {
  const out = busFor(ctx);
  // inharmonic bell partials: hum, prime, tierce, quint, nominal, upper
  const partials = [
    [0.5, 0.55, 4.0],
    [1.0, 1.0, 3.2],
    [1.19, 0.45, 2.4],
    [1.5, 0.35, 2.0],
    [2.0, 0.6, 1.7],
    [2.51, 0.25, 1.2],
    [2.66, 0.2, 1.1],
    [3.01, 0.16, 0.9],
    [4.07, 0.1, 0.6],
  ];
  partials.forEach(([ratio, amp, decay]) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.002);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(amp, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    o.connect(g).connect(out);
    o.onended = () => {
      try {
        o.disconnect();
        g.disconnect();
      } catch {}
    };
    o.start(t0);
    o.stop(t0 + decay + 0.05);
  });
}
function playStrikes(ctx: BaseAudioContext, times: number) {
  const t = ctx.currentTime + 0.03;
  for (let i = 0; i < times; i++) strike(ctx, t + i * 0.85, 784);
}

// Pre-rendered copies played through <audio>, used when Web Audio is blocked.
const fallbackEls: Record<number, HTMLAudioElement> = {};
function toWavDataUri(buf: AudioBuffer) {
  const d = buf.getChannelData(0),
    n = d.length,
    ab = new ArrayBuffer(44 + n * 2),
    v = new DataView(ab);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, d[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return `data:audio/wav;base64,${btoa(bin)}`;
}
async function renderFallback(times: number) {
  try {
    const OAC =
      window.OfflineAudioContext ||
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .webkitOfflineAudioContext;
    if (!OAC) return;
    const sr = 22050;
    const oc = new OAC(1, Math.ceil(sr * (0.03 + (times - 1) * 0.85 + 4.2)), sr);
    playStrikes(oc, times);
    const buf = await oc.startRendering();
    const el = new Audio(toWavDataUri(buf));
    el.preload = "auto";
    fallbackEls[times] = el;
  } catch {}
}
renderFallback(1);
renderFallback(2);
function playFallback(times: number) {
  const el = fallbackEls[times];
  if (!el) return;
  try {
    el.muted = false;
    el.currentTime = 0;
    el.play().catch(() => {});
  } catch {}
}

// Call from a click: unlocks both audio paths for later, timer-driven bells.
export function primeAudio(station?: boolean) {
  // Reuse a context proven to be producing output; otherwise replace it.
  const ctx = healthy && healthy === actx && actx.state === "running" ? audio() : freshAudio();
  if (station) startKeepAlive();
  if (ctx) {
    try {
      const b = ctx.createBuffer(1, 1, 22050),
        s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch {}
  }
  Object.values(fallbackEls).forEach((el) => {
    try {
      el.muted = true;
      el.play()
        .then(() => {
          el.pause();
          el.currentTime = 0;
          el.muted = false;
        })
        .catch(() => {
          el.muted = false;
        });
    } catch {}
  });
}

export function bell(times = 1) {
  if (actx && actx === broken) freshAudio();
  const ctx = audio();
  if (!ctx) return playFallback(times);
  if (ctx.state === "running") {
    playStrikes(ctx, times);
    verifyOrFallback(ctx, times);
    return;
  }
  let done = false;
  const giveUp = setTimeout(() => {
    if (!done) {
      done = true;
      playFallback(times);
    }
  }, 400);
  ctx
    .resume()
    .then(() => {
      if (done) return;
      done = true;
      clearTimeout(giveUp);
      if (ctx.state === "running") {
        playStrikes(ctx, times);
        verifyOrFallback(ctx, times);
      } else playFallback(times);
    })
    .catch(() => {
      if (!done) {
        done = true;
        clearTimeout(giveUp);
        playFallback(times);
      }
    });
}

/** True when the shared AudioContext exists and is running. */
export function audioRunning(): boolean {
  return !!actx && actx.state === "running";
}

/** Click handler for any "Test bell" button. */
export function testBell() {
  primeAudio();
  bell(1);
}
