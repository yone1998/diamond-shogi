/**
 * 効果音: 指定 MP3（駒打ち・終局）＋その他は簡易合成
 */

type SfxKind =
  | "select"
  | "move"
  | "capture"
  | "drop"
  | "check"
  | "promote"
  | "notice"
  | "cancel"
  | "win"
  | "lose"
  | "start"
  | "click"
  | "end";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxGain: GainNode | null = null;
let unlocked = false;
let loadPromise: Promise<void> | null = null;

let placeBuf: AudioBuffer | null = null;
let endBuf: AudioBuffer | null = null;

export let soundEnabled = true;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 1;
    sfxGain.connect(master);
  }
  return ctx;
}

async function decodeUrl(url: string): Promise<AudioBuffer | null> {
  const c = ensureCtx();
  if (!c) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return await c.decodeAudioData(ab.slice(0));
  } catch {
    return null;
  }
}

function ensureSamplesLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    ensureCtx();
    const [p, e] = await Promise.all([
      decodeUrl("/sounds/piece-place.mp3"),
      decodeUrl("/sounds/game-end.mp3"),
    ]);
    placeBuf = p;
    endBuf = e;
  })();
  return loadPromise;
}

export async function unlockAudio(): Promise<void> {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      /* ignore */
    }
  }
  unlocked = c.state === "running";
  void ensureSamplesLoaded();
}

export function setSoundEnabled(on: boolean): void {
  soundEnabled = on;
}

function playBuffer(buf: AudioBuffer, vol = 1): void {
  if (!ctx || !sfxGain) return;
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(g);
  g.connect(sfxGain);
  src.start();
}

function softClick(dest: GainNode, t: number, freq = 480, vol = 0.1): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + 0.05);
}

function playPlaceSample(): boolean {
  if (!placeBuf) return false;
  playBuffer(placeBuf, 1);
  return true;
}

function playEndSample(): boolean {
  if (!endBuf) return false;
  playBuffer(endBuf, 1);
  return true;
}

export function playSfx(kind: SfxKind): void {
  if (!soundEnabled) return;
  const c = ensureCtx();
  if (!c || !sfxGain) return;
  if (c.state === "suspended") void c.resume();
  void unlocked;
  void ensureSamplesLoaded();

  const t = c.currentTime;
  const g = sfxGain;

  switch (kind) {
    case "move":
    case "drop":
    case "capture":
      if (playPlaceSample()) return;
      softClick(g, t, 280, 0.2);
      break;
    case "end":
    case "win":
    case "lose":
      if (playEndSample()) return;
      softClick(g, t, 440, 0.15);
      softClick(g, t + 0.12, 550, 0.12);
      break;
    case "select":
      softClick(g, t, 400, 0.08);
      break;
    case "click":
      softClick(g, t, 360, 0.07);
      break;
    case "check":
    case "promote":
      if (playPlaceSample()) return;
      softClick(g, t, 300, 0.15);
      break;
    case "notice":
      softClick(g, t, 300, 0.09);
      softClick(g, t + 0.1, 240, 0.07);
      break;
    case "cancel":
      softClick(g, t, 200, 0.09);
      break;
    case "start":
      if (!playPlaceSample()) softClick(g, t, 440, 0.1);
      break;
  }
}
