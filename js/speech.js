// speech.js — the co-pilot's voice (TTS) and ears (STT), with graceful fallbacks.

import { settings } from './store.js';

// ---------- Text-to-speech ----------
let voice = null;

function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return;
  const lang = (navigator.language || 'en').slice(0, 2);
  // prefer a local, language-matched voice; "natural"-sounding names first
  voice =
    voices.find(v => v.lang.startsWith(lang) && /natural|neural|samantha|karen|daniel/i.test(v.name)) ||
    voices.find(v => v.lang.startsWith(lang) && v.localService) ||
    voices.find(v => v.lang.startsWith(lang)) ||
    voices[0];
}

if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

// iOS unlocks speechSynthesis only from a user gesture — speak a silent
// utterance on the first tap so later, gesture-less lines actually play.
let ttsPrimed = false;
export function primeTTS() {
  if (ttsPrimed || !('speechSynthesis' in window)) return;
  ttsPrimed = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

let sayTimer = null;

export function say(text, { force = false } = {}) {
  if (!('speechSynthesis' in window)) return;
  if (!force && !settings.get('voice')) return;
  try {
    speechSynthesis.cancel();
    clearTimeout(sayTimer);
    const u = new SpeechSynthesisUtterance(text.replace(/<[^>]+>/g, ' '));
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.pitch = 1.0;
    u.volume = 0.9;
    // Chrome Android drops utterances queued in the same tick as cancel()
    sayTimer = setTimeout(() => { try { speechSynthesis.speak(u); } catch { /* ignore */ } }, 60);
  } catch { /* ignore */ }
}

export function hush() {
  clearTimeout(sayTimer);
  if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch { /* ignore */ } }
}

// ---------- Speech-to-text ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = !!SR;

// The one active recognition, with a finish() that fires the owner's onEnd
// exactly once — whether the browser ends it, the owner stops it, or a new
// listen() preempts it. Callers can therefore always trust onEnd to clean up.
let activeRec = null;

// Start listening. Returns a controller {stop()} or null if unsupported.
// onText(finalText) fires per finalized utterance; onEnd() always fires once.
export function listen({ onText, onEnd, continuous = false } = {}) {
  if (!SR) { onEnd && onEnd('unsupported'); return null; }
  stopListening(); // preempt: the previous owner's onEnd fires now

  const rec = new SR();
  let ended = false;
  const finish = (err) => {
    if (ended) return;
    ended = true;
    if (activeRec && activeRec.rec === rec) activeRec = null;
    onEnd && onEnd(err);
  };
  activeRec = { rec, finish };

  rec.lang = navigator.language || 'en-US';
  rec.continuous = continuous;
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        const text = e.results[i][0].transcript.trim();
        if (text) onText && onText(text);
      }
    }
  };
  rec.onerror = (e) => finish(e.error);
  rec.onend = () => finish();

  try { rec.start(); } catch { finish('failed'); return null; }
  return {
    stop: () => {
      finish(); // owner cleanup runs immediately, not at the browser's leisure
      try { rec.stop(); } catch { /* ignore */ }
    },
  };
}

export function stopListening() {
  if (!activeRec) return;
  const { rec, finish } = activeRec;
  activeRec = null;
  finish('preempted');
  try { rec.stop(); } catch { /* ignore */ }
}
