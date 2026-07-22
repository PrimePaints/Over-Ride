// dump.js — the External Brain. Mid-task intrusive thought? Dump it here,
// unsorted, and get back to what you were doing. The rule engine files it.

import { $ } from './ui.js';
import { say, hush, listen, stopListening, sttSupported } from './speech.js';
import { chime, unlockAudio } from './audio.js';
import { buzz } from './haptics.js';
import { parseDump, typeMeta, TYPES } from './brain.js';
import { crumbs, vault, settings } from './store.js';
import { isConfigured, completeJSON } from './ai.js';
import { record } from './notes.js';

let router = null;
let micCtl = null;
let autoMicTimer = null;
let loopTimer = null;
let onScreen = false;

function show(id) {
  ['dump-capture', 'dump-result'].forEach(x =>
    $('#' + x).classList.toggle('hidden', x !== id));
}

function setMicState(listening) {
  const btn = $('#dump-mic');
  btn.classList.toggle('listening', listening);
  $('#dump-mic-icon').textContent = listening ? '🔴' : '🎤';
  $('#dump-mic-label').textContent = listening ? 'listening… tap to stop' : 'tap to speak';
}

function toggleMic() {
  unlockAudio();
  if (!sttSupported) {
    $('#dump-mic').classList.add('unsupported');
    $('#dump-mic-label').textContent = 'no mic here — type below';
    $('#dump-text').focus();
    return;
  }
  if (micCtl) { micCtl.stop(); return; }
  const handsFree = settings.get('dumpAuto');
  setMicState(true);
  micCtl = listen({
    // hands-free: end after each utterance so it files fast and re-arms;
    // manual: keep listening until tapped off
    continuous: !handsFree,
    onText: (text) => {
      const ta = $('#dump-text');
      ta.value = (ta.value ? ta.value.trim() + ', ' : '') + text;
    },
    onEnd: (err) => {
      micCtl = null;
      setMicState(false);
      if (handsFree && onScreen && err !== 'preempted') handsFreeStep();
    },
  });
  if (!micCtl) setMicState(false);
}

// Hands-free loop: utterance captured → file it → flash the result →
// back to capture with the mic re-armed for the next thought. A silent
// listen (nothing captured) ends the loop.
async function handsFreeStep() {
  const raw = $('#dump-text').value.trim();
  if (!raw) return; // silence — loop ends, stay on capture
  await sortIt({ quiet: true });
  clearTimeout(loopTimer);
  loopTimer = setTimeout(() => {
    if (!onScreen) return;
    $('#dump-text').value = '';
    show('dump-capture');
    toggleMic();
  }, 1600);
}

export function renderCard(item, { interactive = false } = {}) {
  const meta = typeMeta(item.type);
  const card = document.createElement('div');
  card.className = `dump-card c-${item.type}` + (item.done ? ' done' : '');
  const icon = document.createElement('span');
  icon.className = 'd-icon';
  icon.textContent = meta.icon;
  const body = document.createElement('div');
  body.className = 'd-body';
  const type = document.createElement('div');
  type.className = 'd-type';
  type.textContent = meta.label;
  const title = document.createElement('div');
  title.className = 'd-title';
  title.textContent = item.title;
  body.append(type, title);
  if (item.extra) {
    const extra = document.createElement('div');
    extra.className = 'd-extra';
    extra.textContent = item.extra;
    body.appendChild(extra);
  }
  card.append(icon, body);
  if (interactive && item.id) {
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${meta.label}: ${item.title}. Tap to toggle done.`);
    const toggle = () => {
      vault.toggle(item.id);
      card.classList.toggle('done');
      buzz(15);
    };
    card.addEventListener('click', toggle);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  }
  return card;
}

// AI sorting: the co-pilot splits and classifies the dump. Falls back to the
// offline regex engine when there's no key, no signal, or any error.
const SORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'insight'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'type', 'extra', 'when'],
        properties: {
          title: { type: 'string', description: 'short, imperative, in the user\'s own words' },
          type: { type: 'string', enum: Object.keys(TYPES) },
          extra: { type: 'string', description: 'one genuinely useful addition (a draft opener for a contact, a concrete first step, a time tag) or empty string' },
          when: { type: 'string', description: 'time reference if one was stated (e.g. "tomorrow", "Friday 2pm") or empty string' },
        },
      },
    },
    insight: { type: 'string', description: 'one short observation about the user worth remembering from this dump, or empty string if nothing stands out' },
  },
};

const SORT_SYSTEM = `You are the sorting brain of Over-Ride's Brain Dump. The user blurted a raw stream of thought (often speech-transcribed, comma-joined, messy) to get it out of their head. Split it into distinct items and classify each: errand (buy/get/pick up), contact (email/call/message someone), health (symptoms, meds, sleep, mood logs), reminder (time-bound), idea (thoughts to keep), todo (everything else actionable). Keep titles short and in their own words. Never invent items that aren't there; merge fragments that are clearly one thought. The "extra" field is your one chance to actually assist — a draft first line for a contact, the obvious first step for a scary todo — use it when it earns its place, else empty.`;

async function sortWithAI(raw) {
  const out = await completeJSON({
    system: SORT_SYSTEM,
    messages: [{ role: 'user', content: raw }],
    schema: SORT_SCHEMA,
    maxTokens: 1500,
  });
  const items = (out.items || [])
    .filter(i => i && typeof i.title === 'string' && i.title.trim())
    .map(i => ({
      title: i.title.trim().slice(0, 120),
      type: TYPES[i.type] ? i.type : 'todo',
      extra: (i.extra || '').trim().slice(0, 120) || null,
      when: (i.when || '').trim().slice(0, 40) || null,
    }));
  if (!items.length) throw new Error('empty');
  const insight = (out.insight || '').trim();
  if (insight) {
    record({ text: insight.slice(0, 240), kind: 'state', imp: 4, prov: 'inferred', kw: [] });
  }
  return items;
}

async function sortIt({ quiet = false } = {}) {
  if (micCtl) micCtl.stop();
  const raw = $('#dump-text').value.trim();
  if (!raw) { $('#dump-text').focus(); return; }

  const btn = $('#dump-sort');
  let items = null;
  if (isConfigured() && navigator.onLine !== false) {
    btn.disabled = true;
    btn.textContent = 'Sorting…';
    try {
      items = await sortWithAI(raw);
    } catch { /* offline brain takes over */ }
    btn.disabled = false;
    btn.textContent = 'Sort it for me →';
  }
  if (!items || !items.length) items = parseDump(raw);
  if (!items.length) { $('#dump-text').focus(); return; }

  const cardsEl = $('#dump-cards');
  cardsEl.innerHTML = '';
  items.forEach(item => {
    const saved = vault.add(item);
    cardsEl.appendChild(renderCard(saved));
  });

  crumbs.log(`brain-dumped ${items.length} thing${items.length > 1 ? 's' : ''}: “${raw.slice(0, 60)}${raw.length > 60 ? '…' : ''}”`);
  chime();
  buzz([20, 40, 20]);
  show('dump-result');
  // hands-free mode stays silent: TTS here would talk over the re-armed mic
  if (!quiet) say(`Got it. ${items.length} ${items.length === 1 ? 'thing' : 'things'}, filed. Out of your head. Go back to what you were doing.`);
}

export function init(r) {
  router = r;
  $('#dump-mic').addEventListener('click', toggleMic);
  $('#dump-sort').addEventListener('click', () => sortIt());
  $('#dump-return').addEventListener('click', () => router.go('home'));
  $('#dump-more').addEventListener('click', () => {
    $('#dump-text').value = '';
    show('dump-capture');
  });
}

export function enter() {
  onScreen = true;
  $('#dump-text').value = '';
  show('dump-capture');
  setMicState(false);
  crumbs.log('hit “Brain Dump”');
  // zero-friction: fire the mic immediately. Android Chrome often grants the
  // mic one-time-only (permission resets to "ask" every session), so gating on
  // a pre-granted state silently never triggered — worst case now is the
  // browser's own prompt, which is exactly what a voice feature should do.
  clearTimeout(autoMicTimer);
  if (sttSupported) autoMicTimer = setTimeout(toggleMic, 250);
}

export function exit() {
  onScreen = false;
  clearTimeout(autoMicTimer);
  clearTimeout(loopTimer);
  if (micCtl) micCtl.stop(); // fires onEnd synchronously → resets micCtl + UI
  micCtl = null;
  setMicState(false);
  stopListening();
  hush();
}
