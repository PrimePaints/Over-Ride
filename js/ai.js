// ai.js — the co-pilot's uplink. Talks to the Anthropic API straight from the
// browser: bring-your-own-key, the key lives in localStorage on this device,
// and requests go phone → api.anthropic.com with no middleman server.

import { ai as aiStore } from './store.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export const MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8 — smartest' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — fast + smart' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — cheapest' },
];

export function isConfigured() {
  return !!(aiStore.get('apiKey') || '').trim();
}

export class AIError extends Error {
  constructor(msg, kind) { super(msg); this.kind = kind; }
}

function headers() {
  return {
    'content-type': 'application/json',
    'x-api-key': aiStore.get('apiKey').trim(),
    'anthropic-version': API_VERSION,
    // required for CORS: acknowledges the key is being used from a browser
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

function friendly(status, apiMessage) {
  if (status === 401) return new AIError('That API key was rejected. Double-check it in Settings.', 'auth');
  if (status === 403) return new AIError("The key works but isn't allowed to do this. Check your Anthropic account.", 'auth');
  if (status === 429) return new AIError('Rate limited — give it a few seconds, then try again.', 'retry');
  if (status === 529 || status >= 500) return new AIError("Anthropic's servers are struggling right now. Try again in a moment.", 'retry');
  return new AIError(apiMessage || 'The request failed. Try again.', 'request');
}

async function throwHttpError(res) {
  let msg = '';
  try { msg = (await res.json())?.error?.message || ''; } catch { /* body wasn't JSON */ }
  throw friendly(res.status, msg);
}

async function post(body, signal) {
  let res;
  try {
    res = await fetch(API_URL, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new AIError("Can't reach the AI — no connection? Everything else in Over-Ride still works offline.", 'network');
  }
  if (!res.ok) await throwHttpError(res);
  return res;
}

// Streaming chat. Calls onDelta(chunk, fullSoFar) as text arrives; resolves
// with the complete reply. Thinking deltas (Sonnet 5 runs adaptive thinking
// by default) are skipped — only user-visible text is surfaced.
export async function streamChat({ system, messages, onDelta, signal, maxTokens = 2048 }) {
  const res = await post({
    model: aiStore.get('model'),
    max_tokens: maxTokens,
    stream: true,
    system,
    messages,
  }, signal);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop(); // trailing partial line stays in the buffer
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5)); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        full += ev.delta.text;
        if (onDelta) onDelta(ev.delta.text, full);
      } else if (ev.type === 'error') {
        throw friendly(0, ev.error?.message || 'The stream broke mid-reply.');
      }
    }
  }
  if (!full.trim()) throw new AIError('The AI sent back an empty reply. Try again.', 'empty');
  return full;
}

// One-shot request whose reply is guaranteed-valid JSON (structured outputs).
export async function completeJSON({ system, messages, schema, maxTokens = 4000 }) {
  const res = await post({
    model: aiStore.get('model'),
    max_tokens: maxTokens,
    system,
    messages,
    output_config: { format: { type: 'json_schema', schema } },
  });
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new AIError('The model declined that request.', 'refusal');
  if (data.stop_reason === 'max_tokens') throw new AIError('The reply got cut off. Try again.', 'retry');
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new AIError('The AI returned something unreadable. Try again.', 'parse');
  }
}
