// file.js — The File: the co-pilot's scrutable dossier. Everything it knows,
// visible, correctable, deletable. User edits outrank inferences; the
// self-portrait section is user-authored and the AI never writes there.

import { $ } from './ui.js';
import { notes as noteStore, portrait, rhythm, vault, mind as mindStore, ago } from './store.js';
import { rhythmSummary } from './notes.js';

let router = null;
let filter = 'all';

const KIND_META = {
  pattern: { icon: '♻️', label: 'Pattern' },
  trigger: { icon: '⚡', label: 'Trigger' },
  state: { icon: '🌡️', label: 'State' },
  win: { icon: '🏆', label: 'Win' },
  value: { icon: '🧭', label: 'Value' },
  fact: { icon: '📌', label: 'Fact' },
};

function renderMatrixCard() {
  const m = mindStore.get()?.matrix;
  const el = $('#file-matrix');
  if (!m) {
    el.textContent = 'No personality matrix yet — run the screening from the co-pilot.';
    return;
  }
  el.innerHTML = '';
  const name = document.createElement('p');
  name.className = 'file-mx-name';
  name.textContent = `“${m.codename}”`;
  const sum = document.createElement('p');
  sum.className = 'dim';
  sum.textContent = m.summary;
  el.append(name, sum);
}

function renderRhythm() {
  const r = rhythm.get();
  const bars = $('#file-rhythm-bars');
  bars.innerHTML = '';
  const max = Math.max(1, ...r.hourly);
  for (let h = 0; h < 24; h++) {
    const col = document.createElement('div');
    col.className = 'rh-col';
    const spiralShare = r.hourly[h] ? r.spirals[h] / r.hourly[h] : 0;
    const bar = document.createElement('div');
    bar.className = 'rh-bar' + (spiralShare > 0.34 ? ' spiky' : '');
    bar.style.height = Math.round((r.hourly[h] / max) * 100) + '%';
    bar.title = `${String(h).padStart(2, '0')}:00 — ${r.hourly[h]} event${r.hourly[h] === 1 ? '' : 's'}${r.spirals[h] ? `, ${r.spirals[h]} spiral${r.spirals[h] === 1 ? '' : 's'}` : ''}`;
    col.appendChild(bar);
    if (h % 6 === 0) {
      const lbl = document.createElement('span');
      lbl.className = 'rh-lbl';
      lbl.textContent = String(h).padStart(2, '0');
      col.appendChild(lbl);
    }
    bars.appendChild(col);
  }
  $('#file-rhythm-line').textContent = rhythmSummary() || 'Not enough activity yet — the rhythm builds itself as you use the app.';
}

function renderVaultLine() {
  const items = vault.all();
  const open = items.filter(i => !i.done);
  $('#file-vault-line').textContent = items.length
    ? `${open.length} open · ${items.length - open.length} done${open.length ? ` · oldest open is ${ago(open.reduce((a, b) => (a.ts < b.ts ? a : b)).ts)} old` : ''}`
    : 'Vault is empty.';
}

function renderNotes() {
  const list = $('#file-notes');
  list.innerHTML = '';
  const active = noteStore.active()
    .filter(n => filter === 'all' || n.kind === filter)
    .sort((a, b) => b.la - a.la);

  $('#file-notes-count').textContent = `${noteStore.active().length} active`;

  if (!active.length) {
    const p = document.createElement('p');
    p.className = 'dim';
    p.style.textAlign = 'center';
    p.textContent = filter === 'all'
      ? 'No field notes yet. They accumulate as you talk to the co-pilot and use the app.'
      : 'Nothing under this filter yet.';
    list.appendChild(p);
    return;
  }

  active.forEach((n) => {
    const meta = KIND_META[n.kind] || KIND_META.fact;
    const card = document.createElement('div');
    card.className = 'note-card';

    const head = document.createElement('div');
    head.className = 'note-head';
    const kind = document.createElement('span');
    kind.className = 'note-kind k-' + n.kind;
    kind.textContent = `${meta.icon} ${meta.label}`;
    const prov = document.createElement('span');
    prov.className = 'note-prov p-' + n.prov;
    prov.textContent = n.prov + (n.ev > 1 ? ` ×${n.ev}` : '');
    head.append(kind, prov);

    const text = document.createElement('p');
    text.className = 'note-text';
    text.textContent = n.text;

    const foot = document.createElement('div');
    foot.className = 'note-foot';
    const when = document.createElement('span');
    when.className = 'dim';
    when.textContent = ago(n.ts);
    const del = document.createElement('button');
    del.className = 'note-del';
    del.setAttribute('aria-label', 'Delete this note');
    del.textContent = '✕ forget';
    del.addEventListener('click', () => {
      noteStore.remove(n.id); // user deletion is real deletion — scrutability
      renderNotes();
    });
    foot.append(when, del);

    card.append(head, text, foot);
    list.appendChild(card);
  });
}

function renderFilters() {
  const row = $('#file-filter');
  row.innerHTML = '';
  const kinds = ['all', ...Object.keys(KIND_META)];
  kinds.forEach((k) => {
    const b = document.createElement('button');
    b.className = 'chip small' + (filter === k ? ' primary' : '');
    b.textContent = k === 'all' ? 'All' : `${KIND_META[k].icon} ${KIND_META[k].label}`;
    b.addEventListener('click', () => {
      filter = k;
      renderFilters();
      renderNotes();
    });
    row.appendChild(b);
  });
}

export function init(r) {
  router = r;
  const ta = $('#file-portrait');
  ta.addEventListener('change', () => portrait.set(ta.value.trim().slice(0, 600)));
}

export function enter() {
  $('#file-portrait').value = portrait.get();
  renderMatrixCard();
  renderRhythm();
  renderVaultLine();
  renderFilters();
  renderNotes();
}

export function exit() {
  // commit a portrait edit even if the textarea never blurred
  portrait.set($('#file-portrait').value.trim().slice(0, 600));
}
