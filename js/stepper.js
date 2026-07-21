// stepper.js — the Micro-Stepper. For paralysis: the task becomes comically
// small steps, revealed one at a time. It gamifies momentum, not completion.

import { $, confetti, wireMic } from './ui.js';
import { rewardSound, winSound, unlockAudio } from './audio.js';
import { buzz } from './haptics.js';
import { say, hush, stopListening } from './speech.js';
import { breakdown, PRAISE, WIN_LINES, pick } from './brain.js';
import { crumbs, vault, streak } from './store.js';

const PRESETS = ['🧺 Laundry', '🍽️ Dishes', '🚿 Shower', '📧 That email', '🛏️ Get out of bed', '🧹 Tidy up'];

let router = null;
let steps = [];
let idx = 0;
let task = '';

function show(id) {
  ['stepper-ask', 'stepper-run', 'stepper-win'].forEach(x =>
    $('#' + x).classList.toggle('hidden', x !== id));
}

function start(taskText) {
  task = taskText.trim();
  if (!task) return;
  steps = breakdown(task);
  idx = 0;
  crumbs.log(`started micro-stepping: “${task}”`);
  show('stepper-run');
  renderStep();
  say(`Okay. ${task}. I broke it into ${steps.length} tiny steps. You only ever get to see one. Here's the first.`);
}

function renderStep() {
  $('#step-count').textContent = `step ${idx + 1} of ${steps.length}`;
  $('#the-step').textContent = steps[idx];
  $('#momentum-fill').style.width = `${(idx / steps.length) * 100}%`;
  $('#step-lock').textContent = idx < steps.length - 1
    ? `🔒 step ${idx + 2} is locked until you do this one`
    : '🏁 this is the last one';
}

function done() {
  const n = streak.bump();
  rewardSound(idx + 1);
  buzz([30, 40, 60]);
  idx++;
  if (idx >= steps.length) return win();
  const praise = pick(PRAISE);
  say(`${praise}`);
  renderStep();
  // brief flash of praise in the lock line
  const lock = $('#step-lock');
  const orig = lock.textContent;
  lock.textContent = `✨ ${praise} (lifetime steps: ${n})`;
  setTimeout(() => { if (idx < steps.length) renderStep(); }, 1800);
}

function win() {
  show('stepper-win');
  const line = pick(WIN_LINES);
  $('#win-line').textContent = line;
  winSound();
  buzz([50, 60, 50, 60, 120]);
  confetti(90);
  say(line);
  crumbs.log(`FINISHED: “${task}” — every step done`);
  vault.add({ type: 'todo', title: `✅ ${task}`, extra: 'completed via micro-stepper', done: true });
}

export function init(r) {
  router = r;

  const presetRow = $('#stepper-presets');
  PRESETS.forEach(p => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = p;
    b.addEventListener('click', () => { unlockAudio(); start(p.replace(/^\S+\s/, '')); });
    presetRow.appendChild(b);
  });

  wireMic($('#stepper-mic'), (text) => {
    const input = $('#stepper-input');
    input.value = (input.value ? input.value + ' ' : '') + text;
  });

  $('#stepper-start').addEventListener('click', () => { unlockAudio(); start($('#stepper-input').value); });
  $('#stepper-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { unlockAudio(); start($('#stepper-input').value); }
  });

  $('#step-done').addEventListener('click', done);
  $('#stepper-quit').addEventListener('click', () => {
    say('Stopping here is allowed. You still moved.');
    crumbs.log(`paused micro-stepping “${task}” at step ${idx + 1}`);
    router.go('home');
  });
  $('#stepper-again').addEventListener('click', () => {
    $('#stepper-input').value = '';
    show('stepper-ask');
  });
}

export function enter() {
  const handedOff = sessionStorage.getItem('override-task');
  sessionStorage.removeItem('override-task');
  crumbs.log('hit “I\'m Stuck”');
  if (handedOff) {
    $('#stepper-input').value = handedOff;
    start(handedOff);
  } else {
    $('#stepper-input').value = '';
    show('stepper-ask');
  }
}

export function exit() {
  stopListening();
  hush();
}
