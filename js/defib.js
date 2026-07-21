// defib.js — the Defibrillator. For spirals: sensory override → spatial
// distraction → gentle AI hand-off. It doesn't solve your problem; it
// starves the spiral of neurological resources, then hands you back.

import { $, confetti, wireMic } from './ui.js';
import { startNoise, stopNoise, duckNoise, chime, pourSound, winSound, unlockAudio } from './audio.js';
import { startHeartbeat, stopHeartbeat, buzz } from './haptics.js';
import { say, hush } from './speech.js';
import { GROUND_LINES, HANDOFF_LINES, pick } from './brain.js';
import { crumbs } from './store.js';
import { WaterSort } from './game.js';

const GROUND_SECONDS = 10;
const GAME_SECONDS = 60;

let game = null;
let groundTimer = null;
let gameTimer = null;
let ringRaf = null;
let router = null;

function show(phase) {
  ['defib-ground', 'defib-game', 'defib-handoff'].forEach(id => {
    $('#' + id).classList.toggle('hidden', id !== phase);
  });
}

function startGamePhase(seconds = GAME_SECONDS) {
  show('defib-game');
  clearTimeout(groundTimer);
  if (!game) {
    game = new WaterSort($('#tubes'), {
      onPour: () => { pourSound(); buzz(12); },
      onWin: () => { winSound(); buzz([40, 60, 40, 60, 80]); confetti(40); },
    });
  }
  game.newPuzzle();

  // countdown ring
  const fg = $('#timer-fg');
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
  gameTimer = setTimeout(handoff, seconds * 1000);
}

function handoff() {
  clearTimeout(gameTimer);
  cancelAnimationFrame(ringRaf);
  stopHeartbeat();
  duckNoise(0.2); // keep a low blanket of noise — silence can feel abrupt
  show('defib-handoff');
  const line = pick(HANDOFF_LINES);
  $('#handoff-line').innerHTML = line.replace('. ', '.<br>');
  chime();
  setTimeout(() => say(line), 600);
  crumbs.log('came out of a spiral (defibrillator run)');
}

function finish(route = 'home') {
  router.go(route);
}

export function init(r) {
  router = r;

  $('#defib-skip').addEventListener('click', () => startGamePhase());
  $('#game-exit').addEventListener('click', () => finish('home'));

  wireMic($('#handoff-mic'), (text) => {
    const input = $('#handoff-input');
    input.value = (input.value ? input.value + ' ' : '') + text;
  });

  $('#handoff-submit').addEventListener('click', () => {
    const text = $('#handoff-input').value.trim();
    if (text) {
      crumbs.log(`after the spiral, you said you were trying to: “${text}”`);
      say(`Good. ${text}. I'll remember that. Want me to break it into tiny steps?`);
      sessionStorage.setItem('override-task', text);
      finish('stepper');
    } else {
      finish('home');
    }
  });
  $('#handoff-dontknow').addEventListener('click', () => finish('retrace'));
  $('#handoff-cantstart').addEventListener('click', () => finish('stepper'));
  $('#handoff-more').addEventListener('click', () => {
    startNoise();
    startGamePhase(60);
  });
  $('#handoff-done').addEventListener('click', () => finish('home'));
}

export function enter() {
  unlockAudio();
  show('defib-ground');
  $('#ground-text').textContent = pick(GROUND_LINES);
  $('#handoff-input').value = '';
  hush();               // no talking during the override — words are the enemy right now
  startNoise();         // brown noise floods in…
  startHeartbeat();     // …heartbeat haptics ground the body…
  crumbs.log('hit “I\'m Spiraling”');
  clearTimeout(groundTimer);
  groundTimer = setTimeout(() => startGamePhase(), GROUND_SECONDS * 1000); // …then the puzzle hijacks working memory
}

export function exit() {
  clearTimeout(groundTimer);
  clearTimeout(gameTimer);
  cancelAnimationFrame(ringRaf);
  stopHeartbeat();
  stopNoise(2);
  hush();
}
