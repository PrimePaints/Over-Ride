// main.js — router + home triage + vault + settings.
// Design rule: every screen must be escapable in one tap, nothing punishes you.

import { $ } from './ui.js';
import { settings, vault, wipeAll } from './store.js';
import { unlockAudio, stopNoise } from './audio.js';
import { buzz, stopHeartbeat } from './haptics.js';
import * as defib from './defib.js';
import * as retrace from './retrace.js';
import * as stepper from './stepper.js';
import * as dump from './dump.js';
import { renderCard } from './dump.js';

// ---------- router ----------
const flows = { defib, retrace, stepper, dump };
let current = 'home';

const router = {
  go(name) {
    if (flows[current] && flows[current].exit) flows[current].exit();
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = $('#screen-' + name);
    (el || $('#screen-home')).classList.add('active');
    current = el ? name : 'home';
    if (name === 'vault') renderVault();
    if (flows[current] && flows[current].enter) flows[current].enter();
    window.scrollTo(0, 0);
  },
};

// data-go buttons (triage + back buttons)
document.querySelectorAll('[data-go]').forEach(btn => {
  btn.addEventListener('click', () => {
    unlockAudio(); // user gesture — the only reliable moment to arm audio
    buzz(15);
    router.go(btn.dataset.go);
  });
});

$('#btn-vault').addEventListener('click', () => router.go('vault'));
$('#btn-settings').addEventListener('click', () => router.go('settings'));

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

  $('#set-wipe').addEventListener('click', () => {
    if (confirm('Wipe everything Over-Ride remembers on this device?')) {
      wipeAll();
      location.reload();
    }
  });
}
bindSettings();

// ---------- flow init ----------
Object.values(flows).forEach(f => f.init && f.init(router));

// ---------- lifecycle safety ----------
// If the tab is hidden mid-intervention, don't leave noise/vibration running.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && current === 'defib') {
    stopNoise(0.5);
    stopHeartbeat();
  }
});

// ---------- PWA ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline still mostly works without it */ });
  });
}
