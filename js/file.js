// file.js — The File: the co-pilot's scrutable dossier. Everything it knows,
// visible, correctable, deletable. User edits outrank inferences; the
// self-portrait section is user-authored and the AI never writes there.

import { $ } from './ui.js';
import { notes as noteStore, portrait, rhythm, vault, mind as mindStore, dossier, ago } from './store.js';
import { rhythmSummary, urgeSummary } from './notes.js';
import { runSleep, sleepStatus } from './sleep.js';
import { openReads, openPredictions, calibration, receipts, resolveRead, resolvePrediction, expireStale } from './reads.js';
import { refreshEvents, agendaLines, hasAnyAccount, status as gcalStatus } from './gcal.js';
import { AIError } from './ai.js';

let router = null;
let filter = 'all';
let sleepingHere = false;

const KIND_META = {
  pattern: { icon: '♻️', label: 'Pattern' },
  trigger: { icon: '⚡', label: 'Trigger' },
  state: { icon: '🌡️', label: 'State' },
  win: { icon: '🏆', label: 'Win' },
  value: { icon: '🧭', label: 'Value' },
  fact: { icon: '📌', label: 'Fact' },
};

function renderSleepRow() {
  const s = sleepStatus();
  const line = $('#file-sleep-line');
  line.textContent = s.slept
    ? `Last slept ${ago(s.slept)} · ${s.impSum} importance points waiting${s.due ? ' — a cycle is due' : ''}`
    : 'Never slept yet — the dossier below fills in after the first cycle.';
  $('#file-sleep-btn').disabled = sleepingHere;
  $('#file-sleep-btn').textContent = sleepingHere ? '🌙 sleeping…' : '🌙 Sleep on it now';
}

function renderDossier() {
  const d = dossier.get();

  const read = $('#file-read');
  read.textContent = d.profileText || 'No distilled read yet. It gets written during the first sleep cycle.';

  const box = $('#file-patterns');
  box.innerHTML = '';
  if (!d.patterns.length) {
    const p = document.createElement('p');
    p.className = 'dim';
    p.textContent = 'No patterns mapped yet — they need enough field notes to cite as evidence.';
    box.appendChild(p);
  }
  d.patterns.forEach((pat, idx) => {
    const card = document.createElement('div');
    card.className = 'pattern-card';

    const head = document.createElement('div');
    head.className = 'note-head';
    const name = document.createElement('span');
    name.className = 'pattern-name';
    name.textContent = pat.name;
    const conf = document.createElement('span');
    conf.className = 'note-prov p-inferred';
    conf.textContent = `${Math.round(pat.confidence * 100)}% · ${pat.evidence.length} notes`;
    head.append(name, conf);

    const chain = document.createElement('p');
    chain.className = 'pattern-chain';
    chain.textContent = `⚡ ${pat.trigger} → ♻️ ${pat.loop} → 🎁 ${pat.payoff}`;

    const bar = document.createElement('div');
    bar.className = 'conf-bar';
    const fill = document.createElement('div');
    fill.className = 'conf-fill';
    fill.style.width = Math.round(pat.confidence * 100) + '%';
    bar.appendChild(fill);

    card.append(head, chain, bar);

    if (pat.tells.length || pat.exits.length) {
      const meta = document.createElement('p');
      meta.className = 'pattern-meta dim';
      const bits = [];
      if (pat.tells.length) bits.push('tells: ' + pat.tells.join(' · '));
      if (pat.exits.length) bits.push('exits that worked: ' + pat.exits.join(' · '));
      meta.textContent = bits.join('  —  ');
      card.appendChild(meta);
    }

    const foot = document.createElement('div');
    foot.className = 'note-foot';
    const spacer = document.createElement('span');
    const del = document.createElement('button');
    del.className = 'note-del';
    del.textContent = '✕ not me — forget this';
    del.setAttribute('aria-label', 'Delete this pattern');
    del.addEventListener('click', () => {
      const d2 = dossier.get();
      dossier.patch({ patterns: d2.patterns.filter((_, i) => i !== idx) });
      renderDossier();
    });
    foot.append(spacer, del);
    card.appendChild(foot);
    box.appendChild(card);
  });

  const sub = $('#file-substrate');
  sub.innerHTML = '';
  if (d.substrate.length) {
    d.substrate.forEach((s, idx) => {
      const li = document.createElement('li');
      const txt = document.createElement('span');
      txt.textContent = `${s.claim} `;
      const conf = document.createElement('span');
      conf.className = 'dim';
      conf.textContent = `(${Math.round(s.confidence * 100)}%)`;
      const del = document.createElement('button');
      del.className = 'note-del';
      del.textContent = '✕';
      del.setAttribute('aria-label', 'Delete this observation');
      del.addEventListener('click', () => {
        const d2 = dossier.get();
        dossier.patch({ substrate: d2.substrate.filter((_, i) => i !== idx) });
        renderDossier();
      });
      li.append(txt, conf, del);
      sub.appendChild(li);
    });
  }
  $('#file-substrate-wrap').classList.toggle('hidden', !d.substrate.length);
}

function renderMentalist() {
  const cal = calibration();
  const calLine = $('#file-cal-line');
  const bits = [];
  if (cal.resolved) bits.push(`predictions: ${cal.hits}/${cal.resolved} right`);
  if (cal.confirmed || cal.denied) bits.push(`reads: ${cal.confirmed} confirmed, ${cal.denied} denied`);
  calLine.textContent = bits.length ? `Track record — ${bits.join(' · ')}` : 'No track record yet — reads and predictions appear after sleep cycles.';

  // reads
  const rbox = $('#file-reads');
  rbox.innerHTML = '';
  const or = openReads();
  if (!or.length) {
    const p = document.createElement('p');
    p.className = 'dim';
    p.textContent = 'No open reads.';
    rbox.appendChild(p);
  }
  or.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'note-card read-file-card';

    const head = document.createElement('div');
    head.className = 'note-head';
    const lbl = document.createElement('span');
    lbl.className = 'note-kind';
    lbl.textContent = '🔮 read';
    const conf = document.createElement('span');
    conf.className = 'note-prov p-inferred';
    conf.textContent = `${Math.round(r.confidence * 100)}%`;
    head.append(lbl, conf);

    const claim = document.createElement('p');
    claim.className = 'note-text';
    claim.textContent = r.claim;

    const work = document.createElement('details');
    work.className = 'read-work';
    const sum = document.createElement('summary');
    sum.textContent = 'show the working';
    work.appendChild(sum);
    const ul = document.createElement('ul');
    receipts(r).forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
    });
    const test = document.createElement('li');
    test.textContent = `how we'd know: ${r.test}`;
    ul.appendChild(test);
    work.appendChild(ul);

    const row = document.createElement('div');
    row.className = 'read-btns';
    const yes = document.createElement('button');
    yes.className = 'chip small';
    yes.textContent = "✓ that's me";
    const no = document.createElement('button');
    no.className = 'chip small';
    no.textContent = '✗ off the mark';
    yes.addEventListener('click', () => { resolveRead(r.id, true); renderMentalist(); renderNotes(); });
    no.addEventListener('click', () => { resolveRead(r.id, false); renderMentalist(); renderNotes(); });
    row.append(yes, no);

    card.append(head, claim, work, row);
    rbox.appendChild(card);
  });

  // predictions
  const pbox = $('#file-preds');
  pbox.innerHTML = '';
  const op = openPredictions();
  if (!op.length) {
    const p = document.createElement('p');
    p.className = 'dim';
    p.textContent = 'No open predictions.';
    pbox.appendChild(p);
  }
  op.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'note-card';

    const head = document.createElement('div');
    head.className = 'note-head';
    const lbl = document.createElement('span');
    lbl.className = 'note-kind';
    lbl.textContent = '🎯 prediction';
    const due = document.createElement('span');
    due.className = 'dim';
    const days = Math.ceil((p.due - Date.now()) / 864e5);
    due.textContent = days > 0 ? `checkable in ${days}d` : 'due — did it happen?';
    head.append(lbl, due);

    const claim = document.createElement('p');
    claim.className = 'note-text';
    claim.textContent = p.claim;

    const row = document.createElement('div');
    row.className = 'read-btns';
    const yes = document.createElement('button');
    yes.className = 'chip small';
    yes.textContent = '✓ came true';
    const no = document.createElement('button');
    no.className = 'chip small';
    no.textContent = '✗ didn\'t';
    yes.addEventListener('click', () => { resolvePrediction(p.id, true); renderMentalist(); renderNotes(); });
    no.addEventListener('click', () => { resolvePrediction(p.id, false); renderMentalist(); renderNotes(); });
    row.append(yes, no);

    card.append(head, claim, row);
    pbox.appendChild(card);
  });
}

async function sleepNow() {
  if (sleepingHere) return;
  sleepingHere = true;
  $('#file-sleep-err').classList.add('hidden');
  renderSleepRow();
  try {
    await runSleep();
    renderDossier();
    renderMentalist();
    renderNotes();
  } catch (err) {
    const e = $('#file-sleep-err');
    e.textContent = err instanceof AIError ? err.message : 'The sleep cycle failed. Try again.';
    e.classList.remove('hidden');
  }
  sleepingHere = false;
  renderSleepRow();
}

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

function renderUrgesLine() {
  $('#file-urges-line').textContent = urgeSummary() || 'None logged yet — the 🌊 Stop Urge button feeds this.';
}

function renderAgenda() {
  const list = $('#file-agenda');
  const hint = $('#file-agenda-hint');
  list.innerHTML = '';
  const lines = agendaLines(10);
  if (!hasAnyAccount()) {
    hint.textContent = 'Connect your personal and work calendars in Settings — the co-pilot sees your next 48h.';
    hint.classList.remove('hidden');
    return;
  }
  const st = gcalStatus();
  const expired = ['personal', 'work'].filter(s => st[s].state === 'expired');
  if (expired.length) {
    hint.textContent = `${expired.join(' + ')} calendar needs a reconnect in Settings.`;
    hint.classList.remove('hidden');
  } else if (!lines.length) {
    hint.textContent = 'Nothing on the calendars for the next 48 hours.';
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
  }
  lines.forEach((l) => {
    const li = document.createElement('li');
    li.className = l.startsWith('[work]') ? 'ag-work' : 'ag-personal';
    li.textContent = l;
    list.appendChild(li);
  });
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
  $('#file-sleep-btn').addEventListener('click', sleepNow);
}

export function enter() {
  expireStale();
  $('#file-portrait').value = portrait.get();
  renderSleepRow();
  renderDossier();
  renderMentalist();
  renderMatrixCard();
  renderRhythm();
  renderUrgesLine();
  renderAgenda();
  renderVaultLine();
  renderFilters();
  renderNotes();
  refreshEvents().then(renderAgenda).catch(() => {});
}

export function exit() {
  // commit a portrait edit even if the textarea never blurred
  portrait.set($('#file-portrait').value.trim().slice(0, 600));
}
