// audio.js — procedural noise engine + reward sounds. No audio files, all synthesized.

import { settings } from './store.js';

let ctx = null;
let noiseSrc = null;
let noiseGain = null;
let rainLfo = null;

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  // iOS also uses a non-standard 'interrupted' state after calls/Siri
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return ctx;
}

// Build a looping noise buffer. Brown = integrated white (deep rumble),
// pink = Paul Kellet approximation (soft hiss), rain = brown source, shaped downstream.
function makeNoiseBuffer(c, type) {
  const seconds = 6;
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const data = buf.getChannelData(0);

  if (type === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    // brown (also the base for "rain")
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buf;
}

export function startNoise() {
  const c = ensureCtx();
  if (!c) return;
  stopNoise(0); // clean slate

  const type = settings.get('noise');
  const vol = (settings.get('volume') / 100) * 0.55; // cap — this should soothe, not blast

  noiseSrc = c.createBufferSource();
  noiseSrc.buffer = makeNoiseBuffer(c, type);
  noiseSrc.loop = true;

  noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(0.0001, c.currentTime);

  let head = noiseSrc;
  if (type === 'brown') {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    head.connect(lp);
    head = lp;
  } else if (type === 'rain') {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.35;
    head.connect(bp);
    // slow amplitude wobble so it feels like weather, not a fan —
    // as a separate AM stage so it can't fight the fade/duck on noiseGain
    const am = c.createGain();
    am.gain.value = 1;
    bp.connect(am);
    head = am;
    rainLfo = c.createOscillator();
    rainLfo.frequency.value = 0.13;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0.35; // 1 ± 0.35 — never negative
    rainLfo.connect(lfoDepth);
    lfoDepth.connect(am.gain);
    rainLfo.start();
  }

  head.connect(noiseGain);
  noiseGain.connect(c.destination);
  noiseSrc.start();

  // slow fade in — sudden loud noise would be its own jump-scare
  noiseGain.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), c.currentTime + 2.5);
}

export function duckNoise(level = 0.25) {
  if (!ctx || !noiseGain) return;
  const vol = (settings.get('volume') / 100) * 0.55;
  noiseGain.gain.cancelScheduledValues(ctx.currentTime);
  noiseGain.gain.setTargetAtTime(Math.max(vol * level, 0.0001), ctx.currentTime, 0.6);
}

export function stopNoise(fadeSeconds = 1.2) {
  if (rainLfo) { try { rainLfo.stop(); } catch {} rainLfo = null; }
  if (!ctx || !noiseSrc) { noiseSrc = null; noiseGain = null; return; }
  const src = noiseSrc, gain = noiseGain;
  noiseSrc = null; noiseGain = null;
  try {
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(0.0001, ctx.currentTime, Math.max(fadeSeconds / 4, 0.01));
    setTimeout(() => { try { src.stop(); } catch {} }, fadeSeconds * 1000 + 100);
  } catch {
    try { src.stop(); } catch {}
  }
}

function blip(freq, t0, dur, vol, type = 'sine') {
  const c = ensureCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, c.currentTime + t0);
  g.gain.exponentialRampToValueAtTime(vol, c.currentTime + t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(c.currentTime + t0);
  osc.stop(c.currentTime + t0 + dur + 0.05);
}

// Rising arpeggio that climbs with your streak — momentum you can hear.
export function rewardSound(streakN = 1) {
  const base = 392 + Math.min(streakN, 12) * 22; // G4 upward
  blip(base, 0, 0.18, 0.18, 'triangle');
  blip(base * 1.26, 0.09, 0.2, 0.18, 'triangle');
  blip(base * 1.5, 0.18, 0.3, 0.2, 'triangle');
}

export function winSound() {
  [523, 659, 784, 1047].forEach((f, i) => blip(f, i * 0.11, 0.35, 0.2, 'triangle'));
}

export function tick() {
  blip(880, 0, 0.05, 0.06, 'square');
}

export function pourSound() {
  blip(300, 0, 0.12, 0.1, 'sine');
  blip(420, 0.06, 0.12, 0.08, 'sine');
}

// The co-pilot's gentle "I'm here" chime.
export function chime() {
  blip(660, 0, 0.5, 0.12, 'sine');
  blip(880, 0.22, 0.7, 0.1, 'sine');
}

export function unlockAudio() {
  ensureCtx();
}
