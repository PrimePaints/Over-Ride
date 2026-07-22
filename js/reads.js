// reads.js — the mentalist layer: confidence-scored reads the user confirms
// or denies, falsifiable predictions with a visible track record, and the
// JITAI guard that keeps analysis away from active distress.
//
// Anti-Barnum discipline lives here: a read that arrives without receipts
// (≥2 evidence notes) or without a falsifiable test is rejected before it
// can ever be shown. A system that can be visibly wrong earns belief.

import { reads as readStore, predictions as predStore, notes as noteStore, crumbs } from './store.js';
import { record } from './notes.js';

const MAX_OPEN_READS = 8;
const MAX_OPEN_PREDS = 5;
const KEEP_RESOLVED = 30;          // history kept for the track record
const PRED_GRACE_DAYS = 7;         // unresolved this long past due → expired
const SPIRAL_COOLDOWN_MS = 30 * 60e3;

const newId = () => Date.now() + Math.random().toString(16).slice(2);

// ---------- intake (called by the sleep cycle with pre-mapped note ids) ----------
export function addReads(items) {
  let added = 0;
  items.forEach((r) => {
    if (typeof r.claim !== 'string' || !r.claim.trim()) return;
    if (typeof r.test !== 'string' || !r.test.trim()) return;      // no falsifiable test → Barnum risk → reject
    if (!Array.isArray(r.evidence) || r.evidence.length < 2) return; // no receipts → reject
    const claim = r.claim.trim().slice(0, 240);
    const openDupe = readStore.all().some(x => x.status === 'open' && x.claim.toLowerCase() === claim.toLowerCase());
    if (openDupe) return;
    readStore.add({
      id: newId(),
      ts: Date.now(),
      claim,
      confidence: Math.min(1, Math.max(0, Number(r.confidence) || 0.5)),
      evidence: r.evidence.slice(0, 6),
      test: r.test.trim().slice(0, 200),
      status: 'open',
      seen: false,
      resolvedTs: 0,
    });
    added++;
  });
  trimReads();
  return added;
}

export function addPredictions(items) {
  let added = 0;
  items.forEach((p) => {
    if (typeof p.claim !== 'string' || !p.claim.trim()) return;
    if (!Array.isArray(p.evidence) || p.evidence.length < 2) return;
    const days = Math.min(30, Math.max(1, Math.round(Number(p.horizon_days) || 3)));
    predStore.add({
      id: newId(),
      ts: Date.now(),
      claim: p.claim.trim().slice(0, 240),
      due: Date.now() + days * 864e5,
      evidence: p.evidence.slice(0, 6),
      status: 'open',
      resolvedTs: 0,
    });
    added++;
  });
  trimPredictions();
  return added;
}

function trimReads() {
  const all = readStore.all();
  const open = all.filter(r => r.status === 'open').sort((a, b) => b.ts - a.ts);
  const resolved = all.filter(r => r.status !== 'open').sort((a, b) => b.resolvedTs - a.resolvedTs);
  open.slice(MAX_OPEN_READS).forEach(r => { r.status = 'retired'; r.resolvedTs = Date.now(); });
  readStore.replaceAll([...open, ...resolved.slice(0, KEEP_RESOLVED)]);
}

function trimPredictions() {
  const all = predStore.all();
  const open = all.filter(p => p.status === 'open').sort((a, b) => b.ts - a.ts);
  const resolved = all.filter(p => p.status !== 'open').sort((a, b) => b.resolvedTs - a.resolvedTs);
  open.slice(MAX_OPEN_PREDS).forEach(p => { p.status = 'expired'; p.resolvedTs = Date.now(); });
  predStore.replaceAll([...open, ...resolved.slice(0, KEEP_RESOLVED)]);
}

// ---------- queries ----------
export const openReads = () => readStore.all().filter(r => r.status === 'open');
export const openPredictions = () => predStore.all().filter(p => p.status === 'open');
export const unseenRead = () => openReads().find(r => !r.seen) || null;
export const markSeen = (id) => readStore.update(id, { seen: true });

// The receipts behind a read/prediction — texts of the evidence notes.
export function receipts(item) {
  return item.evidence
    .map(id => noteStore.get(id))
    .map(n => (n ? `${n.text} (${n.prov}${n.ev > 1 ? ` ×${n.ev}` : ''})` : '(note since retired)'));
}

// ---------- resolution: agreement is weak evidence, denial is strong ----------
export function resolveRead(id, confirmed) {
  const r = readStore.all().find(x => x.id === id);
  if (!r || r.status !== 'open') return;
  readStore.update(id, { status: confirmed ? 'confirmed' : 'denied', resolvedTs: Date.now() });
  record({
    text: confirmed ? `Confirmed a read: ${r.claim}` : `Rejected a read as off the mark: ${r.claim}`,
    kind: 'fact',
    imp: confirmed ? 4 : 6, // Forer effect — a denial teaches more than a nod
    prov: 'stated',
    kw: [],
  });
}

export function resolvePrediction(id, hit) {
  const p = predStore.all().find(x => x.id === id);
  if (!p || p.status !== 'open') return;
  predStore.update(id, { status: hit ? 'hit' : 'miss', resolvedTs: Date.now() });
  record({
    text: `Prediction ${hit ? 'came true' : 'missed'}: ${p.claim}`,
    kind: hit ? 'pattern' : 'fact',
    imp: hit ? 6 : 7, // a miss is the more informative outcome
    prov: 'stated',
    kw: [],
  });
}

// maintenance: predictions unresolved long past due stop counting
export function expireStale() {
  const cutoff = Date.now() - PRED_GRACE_DAYS * 864e5;
  openPredictions().forEach((p) => {
    if (p.due < cutoff) predStore.update(p.id, { status: 'expired', resolvedTs: Date.now() });
  });
}

// ---------- the track record ----------
export function calibration() {
  const resolved = predStore.all().filter(p => p.status === 'hit' || p.status === 'miss');
  const hits = resolved.filter(p => p.status === 'hit').length;
  const confirmed = readStore.all().filter(r => r.status === 'confirmed').length;
  const denied = readStore.all().filter(r => r.status === 'denied').length;
  return { hits, misses: resolved.length - hits, resolved: resolved.length, confirmed, denied };
}

// ---------- JITAI guard: no analysis fresh out of a spiral OR an urge ----------
export function recentSpiral() {
  const cutoff = Date.now() - SPIRAL_COOLDOWN_MS;
  return crumbs.recent(8).some(c => c.ts > cutoff && /spiral|stop urge|urge wave/i.test(c.text));
}
