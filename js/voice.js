// voice.js — Voice Mode: a live spoken conversation with the co-pilot.
// Gemini Live carries the call; the transcript flows into the chat log so
// Claude's dossier machinery (field notes, sleep cycle) learns from it too.

import { $ } from './ui.js';
import { hush, stopListening } from './speech.js';
import { buzz } from './haptics.js';
import { ai as aiStore, chat, crumbs } from './store.js';
import { chatSystem, matrix } from './mind.js';
import { record } from './notes.js';
import { LiveSession } from './live.js';

let router = null;
let session = null;
let muted = false;

function setStatus(text, cls = '') {
  const el = $('#voice-status');
  el.textContent = text;
  el.className = 'voice-status' + (cls ? ' ' + cls : '');
}

function caption(who, text, done) {
  const box = $('#voice-caps');
  let line = box.lastElementChild;
  const cls = 'cap-' + who;
  if (!line || !line.classList.contains(cls) || line.dataset.done === '1') {
    line = document.createElement('p');
    line.className = 'cap ' + cls;
    box.appendChild(line);
    while (box.children.length > 6) box.firstElementChild.remove();
  }
  line.textContent = (who === 'me' ? 'you — ' : '') + text;
  if (done) line.dataset.done = '1';
  box.scrollTop = box.scrollHeight;
}

function connect() {
  const name = matrix()?.codename || 'Co-Pilot';
  $('#voice-title').textContent = name;
  $('#voice-caps').innerHTML = '';
  $('#voice-orb').classList.remove('talking');
  muted = false;
  $('#voice-mute').classList.remove('muted');

  $('#voice-log').innerHTML = '';
  $('#voice-log-wrap').classList.add('hidden');
  session = new LiveSession({
    system: chatSystem('', { voice: true }),
    onState: (s) => {
      if (s === 'connecting') setStatus('connecting…');
      else if (s === 'live') { setStatus('live — just talk'); buzz([20, 30, 20]); }
      else if (s === 'closed') setStatus('call ended');
      else if (s.startsWith('error:')) {
        setStatus(s.slice(6), 'err');
        if ($('#voice-log').children.length) $('#voice-log-wrap').classList.remove('hidden');
      }
    },
    onAttempt: ({ model, code, reason }) => {
      const li = document.createElement('li');
      li.textContent = `${model} → ${code}${reason ? ' · ' + reason : ''}`;
      $('#voice-log').appendChild(li);
    },
    onUserText: (t, done) => {
      caption('me', t, done);
      if (done) chat.push('user', t);
    },
    onAIText: (t, done) => {
      caption('ai', t, done);
      if (done) chat.push('assistant', t);
    },
    onSpeaking: (talking) => $('#voice-orb').classList.toggle('talking', talking),
  });
  session.start();
}

function hangUp() {
  if (!session) return;
  const turns = session.turns;
  session.stop();
  session = null;
  if (turns > 0) {
    crumbs.log(`had a voice conversation with the co-pilot (${turns} exchange${turns === 1 ? '' : 's'})`);
    record({
      text: `Chose to talk out loud with the co-pilot (${turns} exchanges)`,
      kind: 'state',
      imp: 3,
      prov: 'behavioral',
      kw: ['voice', 'talk'],
    });
  }
}

export function init(r) {
  router = r;
  $('#voice-end').addEventListener('click', () => router.go('copilot'));
  $('#voice-mute').addEventListener('click', () => {
    if (!session) return;
    muted = !muted;
    session.setMuted(muted);
    $('#voice-mute').classList.toggle('muted', muted);
    setStatus(muted ? 'mic muted' : 'live — just talk');
    buzz(12);
  });
  $('#voice-to-settings').addEventListener('click', () => router.go('settings'));
}

export function enter() {
  hush();          // the built-in TTS stays out of the call
  stopListening(); // and so does the built-in STT
  const hasKey = !!(aiStore.get('geminiKey') || '').trim();
  $('#voice-nokey').classList.toggle('hidden', hasKey);
  $('#voice-stage').classList.toggle('hidden', !hasKey);
  if (!hasKey) return;
  connect();
}

export function exit() {
  hangUp();
}
