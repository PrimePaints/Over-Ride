// dump.js — the External Brain. Mid-task intrusive thought? Dump it here,
// unsorted, and get back to what you were doing. The rule engine files it.

import { $ } from './ui.js';
import { say, hush, listen, stopListening, sttSupported } from './speech.js';
import { chime, unlockAudio } from './audio.js';
import { buzz } from './haptics.js';
import { parseDump, typeMeta } from './brain.js';
import { crumbs, vault } from './store.js';

let router = null;
let micCtl = null;

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
  setMicState(true);
  micCtl = listen({
    continuous: true,
    onText: (text) => {
      const ta = $('#dump-text');
      ta.value = (ta.value ? ta.value.trim() + ', ' : '') + text;
    },
    onEnd: () => { micCtl = null; setMicState(false); },
  });
  if (!micCtl) setMicState(false);
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
    card.addEventListener('click', () => {
      vault.toggle(item.id);
      card.classList.toggle('done');
      buzz(15);
    });
  }
  return card;
}

function sortIt() {
  if (micCtl) micCtl.stop();
  const raw = $('#dump-text').value.trim();
  if (!raw) { $('#dump-text').focus(); return; }

  const items = parseDump(raw);
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
  say(`Got it. ${items.length} ${items.length === 1 ? 'thing' : 'things'}, filed. Out of your head. Go back to what you were doing.`);
}

export function init(r) {
  router = r;
  $('#dump-mic').addEventListener('click', toggleMic);
  $('#dump-sort').addEventListener('click', sortIt);
  $('#dump-return').addEventListener('click', () => router.go('home'));
  $('#dump-more').addEventListener('click', () => {
    $('#dump-text').value = '';
    show('dump-capture');
  });
}

export function enter() {
  $('#dump-text').value = '';
  show('dump-capture');
  crumbs.log('hit “Brain Dump”');
  // zero-friction: if mic is available, start listening immediately
  if (sttSupported) setTimeout(toggleMic, 350);
}

export function exit() {
  if (micCtl) micCtl.stop();
  stopListening();
  hush();
}
