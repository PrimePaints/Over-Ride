// copilot.js — the Co-Pilot screen: API setup nudge → personality screening →
// matrix synthesis → review & lock-in → calibrated chat.

import { $, wireMic } from './ui.js';
import { say, hush, stopListening } from './speech.js';
import { buzz } from './haptics.js';
import { crumbs, chat, mind as mindStore } from './store.js';
import { isConfigured, streamChat, AIError } from './ai.js';
import { QUESTIONS, synthesize, saveMatrix, hasMatrix, matrix, chatSystem } from './mind.js';
import { stripObs, parseObs, record, unrecord, harvestTelemetry } from './notes.js';
import { needSleep, runSleep } from './sleep.js';
import { sleepMeter } from './store.js';

let router = null;
let phase = 'setup';
let cal = null;            // {i, answers} while the screening runs
let pendingMatrix = null;  // synthesized but not yet locked in
let streaming = null;      // AbortController while a reply streams

const PHASES = ['cp-setup', 'cp-intro', 'cp-cal', 'cp-synth', 'cp-result', 'cp-chat'];
const TITLES = { setup: 'Co-Pilot', intro: 'Co-Pilot', cal: 'Screening', synth: 'Calibrating', result: 'Your Matrix', chat: '' };

function show(id) {
  phase = id.replace('cp-', '');
  PHASES.forEach(x => $('#' + x).classList.toggle('hidden', x !== id));
  $('#cp-title').textContent = phase === 'chat' ? (matrix()?.codename || 'Co-Pilot') : TITLES[phase];
  const inChat = phase === 'chat';
  $('#cp-file').classList.toggle('hidden', !inChat);
  $('#cp-clear').classList.toggle('hidden', !inChat);
  $('#cp-recal').classList.toggle('hidden', !inChat);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---------- screening ----------
function startCal() {
  cal = { i: 0, answers: {} };
  show('cp-cal');
  renderQuestion();
}

function renderQuestion() {
  const q = QUESTIONS[cal.i];
  $('#cal-fill').style.width = Math.round((cal.i / QUESTIONS.length) * 100) + '%';
  $('#cal-count').textContent = `${cal.i + 1} / ${QUESTIONS.length}`;
  $('#cal-q').textContent = q.q;
  $('#cal-sub').textContent = q.sub || '';

  const chips = $('#cal-chips');
  const freeWrap = $('#cal-free-wrap');
  chips.innerHTML = '';

  if (q.kind === 'free') {
    chips.classList.add('hidden');
    freeWrap.classList.remove('hidden');
    $('#cal-free').value = cal.answers[q.id] || '';
  } else {
    freeWrap.classList.add('hidden');
    chips.classList.remove('hidden');
    const selected = new Set(q.kind === 'multi' ? (cal.answers[q.id] || []) : [cal.answers[q.id]].filter(Boolean));
    q.options.forEach((opt) => {
      const b = document.createElement('button');
      b.className = 'chip' + (selected.has(opt) ? ' primary' : '');
      b.textContent = opt;
      b.addEventListener('click', () => {
        buzz(10);
        if (q.kind === 'multi') {
          selected.has(opt) ? selected.delete(opt) : selected.add(opt);
          cal.answers[q.id] = [...selected];
          b.classList.toggle('primary');
        } else {
          cal.answers[q.id] = opt;
          next();
        }
      });
      chips.appendChild(b);
    });
  }
  $('#cal-next').textContent = cal.i === QUESTIONS.length - 1 ? 'Build my matrix →' : 'Next →';
}

function next() {
  const q = QUESTIONS[cal.i];
  if (q.kind === 'free') cal.answers[q.id] = $('#cal-free').value.trim();
  if (cal.i < QUESTIONS.length - 1) {
    cal.i++;
    renderQuestion();
  } else {
    runSynth();
  }
}

async function runSynth() {
  show('cp-synth');
  $('#synth-spin').classList.remove('hidden');
  $('#synth-err').classList.add('hidden');
  try {
    pendingMatrix = await synthesize(cal.answers);
    buzz([25, 40, 25]);
    renderResult();
  } catch (err) {
    $('#synth-spin').classList.add('hidden');
    $('#synth-err').classList.remove('hidden');
    $('#synth-err-msg').textContent = err instanceof AIError ? err.message : 'Something went wrong building the matrix.';
  }
}

function renderResult() {
  show('cp-result');
  const m = pendingMatrix;
  $('#mx-codename').textContent = m.codename;
  $('#mx-summary').textContent = m.summary;
  $('#mx-do').innerHTML = m.do.map(i => `<li>${esc(i)}</li>`).join('');
  $('#mx-dont').innerHTML = m.dont.map(i => `<li>${esc(i)}</li>`).join('');
}

function lockIn() {
  saveMatrix(cal.answers, pendingMatrix);
  buzz([30, 40, 60]);
  crumbs.log(`calibrated the co-pilot (“${pendingMatrix.codename}”)`);
  chat.clear();
  chat.push('assistant', pendingMatrix.first_line);
  say(pendingMatrix.first_line);
  enterChat();
}

// ---------- the sleep cycle (auto-triggered, runs in the background) ----------
let sleeping = false;

async function maybeSleep() {
  if (sleeping || !needSleep()) return;
  sleeping = true;
  try {
    await runSleep();
    if (phase === 'chat') $('#slept-chip').classList.remove('hidden');
  } catch { /* quiet failure — the meter keeps accumulating, next entry retries */ }
  sleeping = false;
}

// ---------- chat ----------
function enterChat() {
  show('cp-chat');
  $('#slept-chip').classList.add('hidden');
  sleepMeter.bumpSession();
  renderLog();
  maybeSleep(); // fire-and-forget; the chat works normally while it runs
}

function renderLog() {
  const box = $('#chat-log');
  box.innerHTML = '';
  chat.all().forEach(m => box.appendChild(bubble(m.role, m.text)));
  scrollDown();
}

function bubble(role, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + (role === 'user' ? 'me' : 'ai');
  d.textContent = text;
  return d;
}

function scrollDown() {
  const box = $('#chat-log');
  box.scrollTop = box.scrollHeight;
}

// results of the most recent capture, for the "noted" chip's undo
let lastNoted = [];

function hideNotedChip() {
  $('#noted-chip').classList.add('hidden');
  lastNoted = [];
}

function showNotedChip(results) {
  lastNoted = results;
  $('#noted-label').textContent = results.length > 1 ? `noted ×${results.length}` : 'noted';
  $('#noted-chip').classList.remove('hidden');
}

async function send(textArg) {
  const input = $('#chat-input');
  const text = (textArg ?? input.value).trim();
  if (!text || streaming) return;
  input.value = '';
  hush();
  stopListening();
  hideNotedChip();

  chat.push('user', text);
  $('#chat-log').appendChild(bubble('user', text));
  const aiEl = bubble('assistant', '…');
  aiEl.classList.add('waiting');
  $('#chat-log').appendChild(aiEl);
  scrollDown();

  // API rule: the first message must be from the user — drop leading
  // assistant turns (the greeting) from what we send.
  const messages = chat.all().slice(-24).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
  while (messages.length && messages[0].role === 'assistant') messages.shift();

  streaming = new AbortController();
  $('#chat-send').disabled = true;
  try {
    const reply = await streamChat({
      system: chatSystem(text),
      messages,
      signal: streaming.signal,
      onDelta: (_chunk, full) => {
        // stripObs holds back partial markers so the field-note block
        // never flashes on screen mid-stream
        const visible = stripObs(full);
        if (!visible) return;
        aiEl.classList.remove('waiting');
        aiEl.textContent = visible;
        scrollDown();
      },
    });
    const { clean, obs } = parseObs(reply);
    const shown = clean || 'Noted.';
    aiEl.classList.remove('waiting');
    aiEl.textContent = shown;
    chat.push('assistant', shown);
    say(shown);
    if (obs.length) {
      const results = obs.map(record);
      showNotedChip(results);
    }
    scrollDown();
  } catch (err) {
    if (err.name === 'AbortError') {
      aiEl.remove();
    } else {
      aiEl.classList.remove('waiting');
      aiEl.classList.add('err');
      aiEl.textContent = err instanceof AIError ? err.message : 'Something went wrong. Try again.';
      scrollDown();
    }
  } finally {
    streaming = null;
    $('#chat-send').disabled = false;
  }
}

function clearChat() {
  if (streaming) { streaming.abort(); streaming = null; }
  chat.clear();
  const first = matrix()?.first_line;
  if (first) chat.push('assistant', first);
  renderLog();
}

// ---------- lifecycle ----------
export function init(r) {
  router = r;

  $('#cp-to-settings').addEventListener('click', () => router.go('settings'));
  $('#cp-start-cal').addEventListener('click', startCal);
  $('#cal-back').addEventListener('click', () => {
    if (cal && cal.i > 0) { cal.i--; renderQuestion(); } else show('cp-intro');
  });
  $('#cal-next').addEventListener('click', next);
  $('#synth-retry').addEventListener('click', runSynth);
  $('#synth-back').addEventListener('click', () => { show('cp-cal'); renderQuestion(); });
  $('#mx-lock').addEventListener('click', lockIn);
  $('#mx-redo').addEventListener('click', () => show('cp-intro'));
  $('#cp-recal').addEventListener('click', () => show('cp-intro'));
  $('#cp-clear').addEventListener('click', clearChat);
  $('#cp-file').addEventListener('click', () => router.go('file'));
  $('#noted-undo').addEventListener('click', () => {
    unrecord(lastNoted);
    hideNotedChip();
  });
  $('#slept-view').addEventListener('click', () => router.go('file'));

  $('#chat-send').addEventListener('click', () => send());
  $('#chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  wireMic($('#chat-mic'), (t) => {
    const i = $('#chat-input');
    i.value = (i.value ? i.value + ' ' : '') + t;
  });
  wireMic($('#cal-mic'), (t) => {
    const ta = $('#cal-free');
    ta.value = (ta.value ? ta.value + ' ' : '') + t;
  });
}

export function enter() {
  hush();
  harvestTelemetry(); // fold fresh breadcrumbs into rhythm + field notes
  crumbs.log('opened the co-pilot');
  hideNotedChip();
  const recal = sessionStorage.getItem('override-recal');
  sessionStorage.removeItem('override-recal');
  if (!isConfigured()) { show('cp-setup'); return; }
  if (recal || !hasMatrix()) { show('cp-intro'); return; }
  enterChat();
}

export function exit() {
  if (streaming) { streaming.abort(); streaming = null; }
  stopListening();
  hush();
}
