// main.js — router + home triage + vault + settings.
// Design rule: every screen must be escapable in one tap, nothing punishes you.

import { $ } from './ui.js';
import { settings, vault, mind, ai as aiStore, wipeAll } from './store.js';
import { unlockAudio } from './audio.js';
import { buzz } from './haptics.js';
import { primeTTS } from './speech.js';
import { MODELS, isConfigured } from './ai.js';
import * as defib from './defib.js';
import * as retrace from './retrace.js';
import * as stepper from './stepper.js';
import * as dump from './dump.js';
import * as copilot from './copilot.js';
import * as file from './file.js';
import { renderCard } from './dump.js';

// ---------- router ----------
const flows = { defib, retrace, stepper, dump, copilot, file };
let current = 'home';

function show(name) {
  if (flows[current] && flows[current].exit) flows[current].exit();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = $('#screen-' + name);
  (el || $('#screen-home')).classList.add('active');
  current = el ? name : 'home';
  if (current === 'home') updateCopilotSub();
  if (current === 'vault') renderVault();
  if (flows[current] && flows[current].enter) flows[current].enter();
  window.scrollTo(0, 0);
}

// History integration: the stack is always [home, currentScreen] so the
// hardware/browser Back button returns home instead of closing the app.
const router = {
  go(name) {
    if (name === 'home') {
      if (current !== 'home' && history.state && history.state.screen) {
        history.back(); // popstate handler shows home
        return;
      }
      show('home');
      return;
    }
    const entry = { screen: name };
    if (current === 'home') history.pushState(entry, '');
    else history.replaceState(entry, '');
    show(name);
  },
};

window.addEventListener('popstate', (e) => {
  show((e.state && e.state.screen) || 'home');
});
// A reload mid-flow would leave a stale history entry — normalize to home.
if (history.state && history.state.screen) history.replaceState(null, '');

// data-go buttons (triage + back buttons)
document.querySelectorAll('[data-go]').forEach(btn => {
  btn.addEventListener('click', () => {
    unlockAudio(); // user gesture — the only reliable moment to arm audio…
    primeTTS();    // …and to unlock speech synthesis on iOS
    buzz(15);
    router.go(btn.dataset.go);
  });
});

$('#btn-vault').addEventListener('click', () => router.go('vault'));
$('#btn-settings').addEventListener('click', () => router.go('settings'));

// When the on-screen keyboard opens, make sure the focused field is visible.
document.addEventListener('focusin', (e) => {
  if (e.target.matches('input, textarea')) {
    setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
  }
});

// ---------- home: co-pilot state hint ----------
function updateCopilotSub() {
  const sub = $('#copilot-sub');
  if (!isConfigured()) sub.textContent = 'an AI co-pilot, tuned to your brain';
  else if (!mind.get()?.matrix) sub.textContent = 'connected — run the screening';
  else sub.textContent = `“${mind.get().matrix.codename}” is ready`;
}
updateCopilotSub();

// ---------- vault ----------
function renderVault() {
  const list = $('#vault-list');
  list.innerHTML = '';
  const items = vault.all();
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'dim';
    p.style.textAlign = 'center';
    p.textContent = 'Empty. Brain-dump something and it lands here.';
    list.appendChild(p);
    return;
  }
  items.forEach(item => list.appendChild(renderCard(item, { interactive: true })));
}

$('#vault-clear').addEventListener('click', () => {
  vault.clearDone();
  renderVault();
});

// ---------- settings ----------
function bindSettings() {
  const voice = $('#set-voice');
  const haptics = $('#set-haptics');
  const noise = $('#set-noise');
  const volume = $('#set-volume');

  voice.checked = settings.get('voice');
  haptics.checked = settings.get('haptics');
  noise.value = settings.get('noise');
  volume.value = settings.get('volume');

  voice.addEventListener('change', () => settings.set('voice', voice.checked));
  haptics.addEventListener('change', () => settings.set('haptics', haptics.checked));
  noise.addEventListener('change', () => settings.set('noise', noise.value));
  volume.addEventListener('change', () => settings.set('volume', parseInt(volume.value, 10)));

  // AI co-pilot
  const apiKey = $('#set-apikey');
  const model = $('#set-model');
  MODELS.forEach((m) => {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.label;
    model.appendChild(o);
  });
  apiKey.value = aiStore.get('apiKey');
  model.value = aiStore.get('model');
  apiKey.addEventListener('change', () => aiStore.set('apiKey', apiKey.value.trim()));
  model.addEventListener('change', () => aiStore.set('model', model.value));
  $('#set-recal').addEventListener('click', () => {
    sessionStorage.setItem('override-recal', '1');
    router.go('copilot');
  });
  $('#set-file').addEventListener('click', () => router.go('file'));

  // two-tap confirm — native confirm() dialogs are jarring and unstylable
  const wipe = $('#set-wipe');
  let armed = null;
  wipe.addEventListener('click', () => {
    if (armed) {
      clearTimeout(armed);
      wipeAll();
      location.reload();
      return;
    }
    wipe.textContent = 'Tap again to really wipe everything';
    armed = setTimeout(() => {
      armed = null;
      wipe.textContent = 'Wipe all my data';
    }, 4000);
  });
}
bindSettings();

// ---------- flow init ----------
Object.values(flows).forEach(f => f.init && f.init(router));

// ---------- lifecycle safety ----------
// If the tab is hidden mid-intervention, don't leave noise/vibration running;
// when it comes back, pick the intervention up where it left off.
document.addEventListener('visibilitychange', () => {
  if (current !== 'defib') return;
  if (document.hidden) defib.onHidden();
  else defib.onVisible();
});

// ---------- PWA ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline still mostly works without it */ });
  });
}
