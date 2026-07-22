// urge.js — Stop Urge: ride the wave instead of feeding it.
// The sequence is built on the acute-craving literature:
//   1. Urge surfing (Marlatt/Bowen) — a craving is a wave: it peaks and
//      passes in minutes. Naming the intensity starts the decentering.
//   2. Cyclic sighing (Balban et al. 2023) — double-inhale, long exhale;
//      about a minute drops physiological arousal fast.
//   3. Visuospatial load (Skorka-Brown & Andrade's Tetris studies) —
//      craving imagery and the tube puzzle compete for the same working
//      memory; a few minutes of play reliably knocks craving intensity down.
//   4. Before/after intensity + trigger logging — self-monitoring itself
//      reduces urges, and it feeds the Mentalist Engine's pattern map.
// Never shame: an abandoned wave is data, not failure (abstinence-violation
// effect — guilt fuels relapse).

import { $, confetti } from './ui.js';
import { chime, winSound, pourSound, unlockAudio } from './audio.js';
import { buzz } from './haptics.js';
import { say, hush } from './speech.js';
import { crumbs, urges, settings } from './store.js';
import { WaterSort, gameHelp } from './game.js';

const GAME_SECONDS = 180;
const MORE_SECONDS = 120;
const TRIGGERS = ['Bored', 'Stressed', 'Lonely', 'Tired', 'Hungry', 'Angry', 'Saw a cue', 'Habit hour', 'Not sure'];

// One cyclic-sigh round: big nasal inhale, short top-up, long mouth exhale.
const BREATH_CYCLE = [
  { text: 'breathe in through your nose…', scale: 1.35, ms: 1700 },
  { text: '…and a little more, on top', scale: 1.55, ms: 800 },
  { text: 'now long and slow out through your mouth', scale: 0.8, ms: 5400 },
  { text: ' ', scale: 0.8, ms: 700 },
];
const BREATH_ROUNDS = 7; // ≈ one minute

let router = null;
let game = null;
let before = null;
let after = null;
let trigger = null;
let finalized = false;
let breathTimer = null;
let gameTimer = null;
let ringRaf = null;

const PHASES = ['urge-in', 'urge-breath', 'urge-game', 'urge-check', 'urge-crest', 'urge-win'];
function show(id) {
  PHASES.forEach(x => $('#' + x).classList.toggle('hidden', x !== id));
}

function scaleChips(el, onPick) {
  el.innerHTML = '';
  for (let n = 0; n <= 10; n++) {
    const b = document.createElement('button');
    b.className = 'chip num';
    b.textContent = n;
    b.addEventListener('click', () => { buzz(12); onPick(n); });
    el.appendChild(b);
  }
}

// ---------- stage 1: the sigh ----------
function startBreath() {
  show('urge-breath');
  const circle = $('#breath-circle');
  const text = $('#breath-text');
  let round = 0;
  let step = 0;
  const tick = () => {
    if (round >= BREATH_ROUNDS) { startGame(GAME_SECONDS); return; }
    const c = BREATH_CYCLE[step];
    text.textContent = c.text;
    circle.style.transitionDuration = c.ms + 'ms';
    circle.style.transform = `scale(${c.scale})`;
    if (step < 2) buzz(8);
    step = (step + 1) % BREATH_CYCLE.length;
    if (step === 0) round++;
    breathTimer = setTimeout(tick, c.ms);
  };
  tick();
}

// ---------- stage 2: the tubes ----------
function startGame(seconds) {
  show('urge-game');
  clearTimeout(breathTimer);
  if (!game) {
    game = new WaterSort($('#urge-tubes'), {
      onPour: () => { pourSound(); buzz(12); },
      onWin: () => { winSound(); buzz([40, 60, 40]); },
    });
  }
  game.newPuzzle();
  const begin = () => startRing(seconds);
  if (!settings.get('gameHelpSeen')) {
    gameHelp($('#urge-game'), () => { settings.set('gameHelpSeen', true); begin(); });
  } else {
    begin();
  }
}

function startRing(seconds) {
  const fg = $('#urge-fg');
  const t0 = performance.now();
  cancelAnimationFrame(ringRaf);
  const CIRC = 100.5;
  const tickRing = (now) => {
    const frac = Math.min((now - t0) / (seconds * 1000), 1);
    fg.style.strokeDashoffset = (frac * CIRC).toFixed(1);
    if (frac < 1) ringRaf = requestAnimationFrame(tickRing);
  };
  ringRaf = requestAnimationFrame(tickRing);
  clearTimeout(gameTimer);
  gameTimer = setTimeout(check, seconds * 1000);
}

// ---------- stage 3: re-rate ----------
function check() {
  clearTimeout(gameTimer);
  cancelAnimationFrame(ringRaf);
  if (game) game.stop();
  show('urge-check');
  chime();
}

function onAfter(n) {
  after = n;
  // a real drop (or a low absolute level) is a ridden wave; otherwise
  // acknowledge the crest — no shame, waves take minutes
  if (after <= 3 || (before !== null && after <= before - 2)) win();
  else show('urge-crest');
}

// ---------- stage 4: the win ----------
function win() {
  finalized = false;
  trigger = null;
  show('urge-win');
  confetti(30);
  winSound();
  buzz([30, 50, 70]);
  const total = urges.get().ridden + 1;
  const drop = before !== null && after !== null && after < before ? ` ${before} → ${after}.` : '';
  $('#urge-win-line').innerHTML = `Wave ridden.${drop}<br><span class="dim">that's ${total} now — the score only goes up</span>`;
  say(`Wave ridden. That's ${total}.`);

  const chips = $('#urge-triggers');
  chips.innerHTML = '';
  TRIGGERS.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'chip small';
    b.textContent = t;
    b.addEventListener('click', () => {
      buzz(10);
      trigger = t.toLowerCase();
      [...chips.children].forEach(c => c.classList.toggle('primary', c === b));
      finalize(true); // re-finalizes with the trigger attached
    });
    chips.appendChild(b);
  });
  finalize(true);
}

// Write the log + crumb exactly once (amended if a trigger arrives after).
let loggedThisRun = false;
function finalize(rode) {
  if (!loggedThisRun) {
    urges.logWave({ trigger, before, after, rode });
    loggedThisRun = true;
  } else if (trigger) {
    urges.amendLastTrigger(trigger);
  }
  if (!finalized && rode) {
    crumbs.log(`rode out an urge wave (${before ?? '?'}→${after ?? '?'})`);
    finalized = true;
  }
}

// ---------- lifecycle ----------
export function init(r) {
  router = r;

  scaleChips($('#urge-scale-in'), (n) => { before = n; startBreath(); });
  scaleChips($('#urge-scale-out'), onAfter);

  $('#breath-skip').addEventListener('click', () => { clearTimeout(breathTimer); startGame(GAME_SECONDS); });
  $('#urge-game-done').addEventListener('click', check);
  $('#crest-more').addEventListener('click', () => startGame(MORE_SECONDS));
  $('#crest-copilot').addEventListener('click', () => {
    // needing backup is not the same as riding it out — log honestly
    finalize(false);
    crumbs.log('took an urge wave to the co-pilot');
    router.go('copilot');
  });
  $('#crest-done').addEventListener('click', win);
  $('#urge-talk').addEventListener('click', () => router.go('copilot'));
}

export function enter() {
  unlockAudio();
  before = null;
  after = null;
  trigger = null;
  finalized = false;
  loggedThisRun = false;
  hush();
  show('urge-in');
  crumbs.log('hit “Stop Urge”');
  say('Good. You picked up the phone instead. How big is the wave, zero to ten?');
}

export function exit() {
  clearTimeout(breathTimer);
  clearTimeout(gameTimer);
  cancelAnimationFrame(ringRaf);
  if (game) game.stop();
  hush();
  // left mid-flow: still worth logging — data, not failure
  if (!loggedThisRun && before !== null) {
    urges.logWave({ trigger: null, before, after: null, rode: false });
    loggedThisRun = true;
  }
}
