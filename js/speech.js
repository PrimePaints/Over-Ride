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

export function say(text, { force = false } = {}) {
  if (!('speechSynthesis' in window)) return;
  if (!force && !settings.get('voice')) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/<[^>]+>/g, ' '));
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.pitch = 1.0;
    u.volume = 0.9;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

export function hush() {
  if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch { /* ignore */ } }
}

// ---------- Speech-to-text ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = !!SR;

let activeRec = null;

// Start listening. Returns a controller {stop()} or null if unsupported.
// onText(finalText) fires per finalized utterance; onEnd() when recognition stops.
export function listen({ onText, onEnd, continuous = false } = {}) {
  if (!SR) { onEnd && onEnd('unsupported'); return null; }
  stopListening();

  const rec = new SR();
  activeRec = rec;
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
  rec.onerror = (e) => { if (activeRec === rec) activeRec = null; onEnd && onEnd(e.error); };
  rec.onend = () => { if (activeRec === rec) { activeRec = null; onEnd && onEnd(); } };

  try { rec.start(); } catch { activeRec = null; onEnd && onEnd('failed'); return null; }
  return { stop: () => { try { rec.stop(); } catch { /* ignore */ } } };
}

export function stopListening() {
  if (activeRec) {
    const r = activeRec;
    activeRec = null;
    try { r.onend = null; r.onerror = null; r.stop(); } catch { /* ignore */ }
  }
}
