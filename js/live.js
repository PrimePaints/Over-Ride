// live.js — the co-pilot's voice: a browser-direct WebSocket client for the
// Gemini Live API. Mic PCM goes up at 16kHz, spoken replies come back at
// 24kHz, and both sides are transcribed so the conversation lands in the
// chat log for Claude's dossier work. No server anywhere.

import { ai as aiStore } from './store.js';

const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// Tried in order until one accepts the setup — Live model names move fast.
// Google retired the whole 2.5-Live generation (gemini-live-2.5-flash*,
// gemini-2.0-flash-live-001 shut down 2025-12-09); the current line is 3.1.
const MODEL_CANDIDATES = [
  'gemini-3.1-flash-live-preview',        // recommended for all Live use
  'gemini-2.5-flash-native-audio-latest', // alias for the newest 2.5 native-audio snapshot
];

const IN_RATE = 16000;
const OUT_RATE = 24000;
const CHUNK_SAMPLES = 2048; // ~128ms per upload

function b64FromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function bytesFromB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// One live session. Callbacks:
//   onState(state)        'connecting' | 'live' | 'closed' | 'error:<msg>'
//   onUserText(t, done)   running transcript of what the user said
//   onAIText(t, done)     running transcript of what the co-pilot said
//   onSpeaking(bool)      AI audio currently playing (drives the orb)
export class LiveSession {
  constructor({ system, onState, onUserText, onAIText, onSpeaking, onAttempt }) {
    this.system = system;
    this.onState = onState || (() => {});
    this.onUserText = onUserText || (() => {});
    this.onAIText = onAIText || (() => {});
    this.onSpeaking = onSpeaking || (() => {});
    this.onAttempt = onAttempt || (() => {}); // diagnostics: one call per failed connect
    this.ws = null;
    this.ready = false;
    this.closedByUs = false;
    this.candidate = 0;
    this.attempts = []; // {model, code, reason}
    this.micStream = null;
    this.ctxIn = null;
    this.ctxOut = null;
    this.playHead = 0;
    this.liveSources = new Set();
    this.userBuf = '';
    this.aiBuf = '';
    this.turns = 0; // completed exchanges, for the caller's bookkeeping
  }

  async start() {
    this.onState('connecting');
    try {
      await this.initAudioIn();
    } catch {
      this.onState('error:Mic access was refused — voice mode needs the microphone.');
      return;
    }
    this.connect();
  }

  connect() {
    const model = MODEL_CANDIDATES[this.candidate];
    if (!model) {
      // every candidate failed — echo Google's own words, they name the real problem
      const hint = this.attempts.find(a => a.reason)?.reason || 'no reason given by Google';
      this.onState(`error:Google refused every Live model. Its own error: “${hint}”`);
      this.teardownAudio();
      return;
    }
    const key = (aiStore.get('geminiKey') || '').trim();
    this.ready = false;
    this.ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(key)}`);

    this.ws.addEventListener('open', () => {
      this.ws.send(JSON.stringify({
        setup: {
          model: `models/${model}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
          },
          systemInstruction: { parts: [{ text: this.system }] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          contextWindowCompression: { slidingWindow: {} },
        },
      }));
    });

    this.ws.addEventListener('message', async (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : await ev.data.text();
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      this.handle(msg);
    });

    this.ws.addEventListener('close', (ev) => {
      if (this.closedByUs) return;
      if (!this.ready) {
        // setup rejected (bad model name, key restrictions…) — log & try the next
        const attempt = { model, code: ev.code, reason: (ev.reason || '').slice(0, 300) };
        this.attempts.push(attempt);
        this.onAttempt(attempt);
        this.candidate++;
        this.connect();
        return;
      }
      this.onState(ev.code === 1000 ? 'closed' : `error:The call dropped (${ev.reason || 'connection closed'}).`);
      this.teardownAudio();
    });
  }

  handle(msg) {
    if (msg.setupComplete) {
      this.ready = true;
      this.playHead = 0;
      this.onState('live');
      return;
    }
    const sc = msg.serverContent;
    if (!sc) return;

    if (sc.interrupted) {
      // the user talked over the reply — kill queued audio immediately
      this.liveSources.forEach((s) => { try { s.stop(); } catch { /* raced */ } });
      this.liveSources.clear();
      if (this.ctxOut) this.playHead = this.ctxOut.currentTime;
      this.onSpeaking(false);
    }

    if (sc.inputTranscription?.text) {
      this.userBuf += sc.inputTranscription.text;
      this.onUserText(this.userBuf, false);
    }
    if (sc.outputTranscription?.text) {
      this.aiBuf += sc.outputTranscription.text;
      this.onAIText(this.aiBuf, false);
    }

    (sc.modelTurn?.parts || []).forEach((p) => {
      if (p.inlineData?.data && (p.inlineData.mimeType || '').startsWith('audio/pcm')) {
        this.playChunk(p.inlineData.data);
      }
    });

    if (sc.turnComplete) {
      if (this.userBuf.trim()) this.onUserText(this.userBuf.trim(), true);
      if (this.aiBuf.trim()) { this.onAIText(this.aiBuf.trim(), true); this.turns++; }
      this.userBuf = '';
      this.aiBuf = '';
    }
  }

  // ---------- mic → 16kHz PCM → websocket ----------
  async initAudioIn() {
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.ctxIn = new AudioContext({ sampleRate: IN_RATE });
    const workletCode = `
      class PCMTap extends AudioWorkletProcessor {
        process(inputs) {
          const ch = inputs[0] && inputs[0][0];
          if (ch) this.port.postMessage(ch.slice(0));
          return true;
        }
      }
      registerProcessor('pcm-tap', PCMTap);`;
    const url = URL.createObjectURL(new Blob([workletCode], { type: 'application/javascript' }));
    await this.ctxIn.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const src = this.ctxIn.createMediaStreamSource(this.micStream);
    const tap = new AudioWorkletNode(this.ctxIn, 'pcm-tap');
    const sink = this.ctxIn.createGain();
    sink.gain.value = 0; // keep the graph pulling without monitoring the mic
    src.connect(tap);
    tap.connect(sink);
    sink.connect(this.ctxIn.destination);

    let acc = new Float32Array(0);
    tap.port.onmessage = (e) => {
      if (!this.ready || !this.ws || this.ws.readyState !== 1) return;
      const merged = new Float32Array(acc.length + e.data.length);
      merged.set(acc); merged.set(e.data, acc.length);
      acc = merged;
      while (acc.length >= CHUNK_SAMPLES) {
        const chunk = acc.subarray(0, CHUNK_SAMPLES);
        acc = acc.slice(CHUNK_SAMPLES);
        const pcm = new Int16Array(chunk.length);
        for (let i = 0; i < chunk.length; i++) {
          const v = Math.max(-1, Math.min(1, chunk[i]));
          pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }
        this.ws.send(JSON.stringify({
          realtimeInput: {
            audio: { data: b64FromBytes(new Uint8Array(pcm.buffer)), mimeType: `audio/pcm;rate=${IN_RATE}` },
          },
        }));
      }
    };
  }

  // ---------- websocket → 24kHz PCM → speakers ----------
  playChunk(b64) {
    if (!this.ctxOut) {
      this.ctxOut = new AudioContext({ sampleRate: OUT_RATE });
      this.playHead = 0;
    }
    const bytes = bytesFromB64(b64);
    const pcm = new Int16Array(bytes.buffer);
    const buf = this.ctxOut.createBuffer(1, pcm.length, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;

    const srcNode = this.ctxOut.createBufferSource();
    srcNode.buffer = buf;
    srcNode.connect(this.ctxOut.destination);
    const at = Math.max(this.ctxOut.currentTime, this.playHead);
    srcNode.start(at);
    this.playHead = at + buf.duration;
    this.liveSources.add(srcNode);
    this.onSpeaking(true);
    srcNode.onended = () => {
      this.liveSources.delete(srcNode);
      if (!this.liveSources.size) this.onSpeaking(false);
    };
  }

  setMuted(muted) {
    (this.micStream?.getAudioTracks() || []).forEach(t => { t.enabled = !muted; });
  }

  teardownAudio() {
    (this.micStream?.getTracks() || []).forEach(t => t.stop());
    this.micStream = null;
    if (this.ctxIn) { this.ctxIn.close().catch(() => {}); this.ctxIn = null; }
    if (this.ctxOut) { this.ctxOut.close().catch(() => {}); this.ctxOut = null; }
    this.liveSources.clear();
    this.onSpeaking(false);
  }

  stop() {
    this.closedByUs = true;
    try { this.ws && this.ws.close(1000); } catch { /* already gone */ }
    this.teardownAudio();
    this.onState('closed');
  }
}
