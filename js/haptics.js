// haptics.js — heartbeat rhythm + reward buzzes.
// navigator.vibrate is Android/Chrome; on iOS this silently no-ops (see README).

import { settings } from './store.js';

const canVibrate = 'vibrate' in navigator;

export function buzz(pattern = 30) {
  if (!canVibrate || !settings.get('haptics')) return;
  try { navigator.vibrate(pattern); } catch { /* ignore */ }
}

let beatTimer = null;
let beatInterval = 800;   // start ~75bpm equivalent
const BEAT_MAX = 1150;    // ramp down toward ~52bpm — entrainment, not alarm

// Slow lub-dub, gradually decelerating. The nervous system tends to follow.
export function startHeartbeat() {
  stopHeartbeat();
  if (!canVibrate || !settings.get('haptics')) return;
  beatInterval = 800;
  const beat = () => {
    try { navigator.vibrate([40, 90, 60]); } catch { /* ignore */ }
    beatInterval = Math.min(beatInterval + 6, BEAT_MAX);
    beatTimer = setTimeout(beat, beatInterval);
  };
  beat();
}

export function stopHeartbeat() {
  if (beatTimer) { clearTimeout(beatTimer); beatTimer = null; }
  if (canVibrate) { try { navigator.vibrate(0); } catch { /* ignore */ } }
}

export const hapticsSupported = canVibrate;
