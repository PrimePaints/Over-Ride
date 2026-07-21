// retrace.js — the Retracer. For the doorway effect: rapid-fire grounding
// questions walk your attention backwards until the thought resurfaces.

import { $, wireMic } from './ui.js';
import { say, hush } from './speech.js';
import { chime } from './audio.js';
import { RETRACE_SCRIPT } from './brain.js';
import { crumbs, vault, ago } from './store.js';

let router = null;
let step = 0;

function ask() {
  const item = RETRACE_SCRIPT[step];
  if (!item) return;
  $('#retrace-q').textContent = item.q;
  say(item.q);

  const grid = $('#retrace-answers');
  grid.innerHTML = '';
  const free = $('#retrace-free');
  free.classList.toggle('hidden', item.kind !== 'free');

  if (item.kind === 'chips') {
    item.answers.forEach(a => {
      const b = document.createElement('button');
      b.className = 'chip' + (a.includes('Got it') ? ' primary' : '');
      b.textContent = a;
      b.addEventListener('click', () => answer(a, item));
      grid.appendChild(b);
    });
  } else {
    $('#retrace-input').value = '';
    setTimeout(() => $('#retrace-input').focus(), 100);
  }
}

function answer(text, item) {
  crumbs.log(`retrace: “${item.q}” → “${text}”`);
  if (item.isFinal) {
    if (text.includes('Got it')) return gotIt();
    return stillBlank();
  }
  step++;
  ask();
}

function gotIt() {
  $('#retrace-answers').innerHTML = '';
  $('#retrace-free').classList.add('hidden');
  $('#retrace-q').textContent = '💡 There it is. Say it out loud once — then go do it before it slips.';
  chime();
  say('There it is. Say it out loud once, then go do it before it slips.');
  const grid = $('#retrace-answers');
  const done = document.createElement('button');
  done.className = 'chip primary';
  done.textContent = 'On it →';
  done.addEventListener('click', () => router.go('home'));
  const save = document.createElement('button');
  save.className = 'chip';
  save.textContent = '💾 Save it to my vault first';
  save.addEventListener('click', () => {
    const what = prompt('What was it? (so the vault remembers even if you don\'t)');
    if (what) vault.add({ type: 'todo', title: what, extra: 'recovered by the Retracer' });
    router.go('home');
  });
  grid.append(done, save);
}

function stillBlank() {
  $('#retrace-answers').innerHTML = '';
  $('#retrace-free').classList.add('hidden');
  $('#retrace-q').textContent = 'That\'s okay. It\'ll surface on its own — they always do. What now?';
  say('That\'s okay. It will surface on its own. They always do.');
  const grid = $('#retrace-answers');
  const mk = (label, fn, primary = false) => {
    const b = document.createElement('button');
    b.className = 'chip' + (primary ? ' primary' : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    grid.appendChild(b);
  };
  mk('⏰ Nudge me to re-check in a bit', () => {
    vault.add({ type: 'reminder', title: 'That thing you forgot — did it come back?', extra: '⏰ check in ~10 min' });
    router.go('home');
  }, true);
  mk('🗣️ Brain dump what I do remember', () => router.go('dump'));
  mk('Home', () => router.go('home'));
}

function renderClues() {
  const list = $('#clues-list');
  list.innerHTML = '';
  const items = [];

  const now = new Date();
  items.push(`<b>Time:</b> ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, ${now.toLocaleDateString([], { weekday: 'long' })}`);

  const recent = crumbs.recent(5).filter(c => !c.text.startsWith('hit “I\'m'));
  recent.forEach(c => items.push(`<b>${ago(c.ts)}:</b> ${escapeHtml(c.text)}`));

  const openItems = vault.all().filter(i => !i.done).slice(0, 3);
  openItems.forEach(i => items.push(`<b>In your vault:</b> ${escapeHtml(i.title)}`));

  if (items.length === 1) items.push('No breadcrumbs yet — the more you use Over-Ride, the more clues I\'ll have.');

  items.forEach(html => {
    const li = document.createElement('li');
    li.innerHTML = html;
    list.appendChild(li);
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function init(r) {
  router = r;
  wireMic($('#retrace-mic'), (text) => { $('#retrace-input').value = text; });
  const submitFree = () => {
    const v = $('#retrace-input').value.trim();
    answer(v || '(skipped)', RETRACE_SCRIPT[step]);
  };
  $('#retrace-input-ok').addEventListener('click', submitFree);
  $('#retrace-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitFree(); });
}

export function enter() {
  step = 0;
  $('#clues-panel').open = false;
  renderClues();
  crumbs.log('hit “I Forgot”');
  $('#retrace-q').textContent = 'Don\'t panic. It\'s in there. Let\'s retrace.';
  say('Don\'t panic. It\'s in there. Let\'s retrace.');
  setTimeout(() => { if (step === 0) ask(); }, 1600);
}

export function exit() {
  hush();
}
