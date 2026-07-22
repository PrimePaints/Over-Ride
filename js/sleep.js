// sleep.js — the sleep cycle: one consolidation call that turns raw field
// notes into understanding. Merges duplicates, arbitrates contradictions,
// maps trigger→loop→payoff patterns, distills the profile — with every
// generalization required to cite its evidence, enforced client-side.

import { completeJSON } from './ai.js';
import { notes as noteStore, dossier, sleepMeter, urges } from './store.js';
import { record, decayScore } from './notes.js';
import { addReads, addPredictions, openReads, openPredictions, calibration } from './reads.js';

const IMP_THRESHOLD = 120;    // accumulated note-importance that triggers a cycle
const SESSION_THRESHOLD = 10; // ...or this many chat sessions, whichever first
const MIN_NOTES = 8;          // never sleep on near-empty evidence
const MAX_PATTERNS = 10;
const MAX_SUBSTRATE = 8;
const MAX_PROFILE_CHARS = 4000; // ≈1,000 tokens
const TOMBSTONE_DAYS = 90;
const NOTES_CAP = 250;        // strongest notes sent into the cycle

export function needSleep() {
  const m = sleepMeter.get();
  if (noteStore.active().length < MIN_NOTES) return false;
  return m.impSum >= IMP_THRESHOLD || m.sessions >= SESSION_THRESHOLD;
}

export function sleepStatus() {
  const m = sleepMeter.get();
  return { slept: dossier.get().slept, impSum: m.impSum, sessions: m.sessions, due: needSleep() };
}

const SLEEP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['merges', 'supersede', 'patterns', 'substrate', 'insights', 'profile', 'reads', 'predictions'],
  properties: {
    merges: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['keep_id', 'absorb_ids'],
        properties: { keep_id: { type: 'string' }, absorb_ids: { type: 'array', items: { type: 'string' } } },
      },
    },
    supersede: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'why'],
        properties: { id: { type: 'string' }, why: { type: 'string' } },
      },
    },
    patterns: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'trigger', 'loop', 'payoff', 'tells', 'exits', 'confidence', 'evidence'],
        properties: {
          name: { type: 'string' },
          trigger: { type: 'string', description: 'the antecedent, incl. which aversive feature (ambiguity, boredom, being judged…)' },
          loop: { type: 'string', description: 'the behavior and thought-loop that follows' },
          payoff: { type: 'string', description: 'what relief the loop buys — the reason it persists' },
          tells: { type: 'array', items: { type: 'string' }, description: 'earliest observable markers' },
          exits: { type: 'array', items: { type: 'string' }, description: 'only exits that have ACTUALLY worked per the notes' },
          confidence: { type: 'number', description: '0 to 1' },
          evidence: { type: 'array', items: { type: 'string' }, description: 'note ids, minimum 2' },
        },
      },
    },
    substrate: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['claim', 'confidence', 'evidence'],
        properties: {
          claim: { type: 'string', description: 'hedged behavioral description, never an identity label' },
          confidence: { type: 'number' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    insights: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['text', 'kind', 'keywords', 'evidence'],
        properties: {
          text: { type: 'string' },
          kind: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    profile: { type: 'string', description: 'the distilled read, ≤350 words' },
    reads: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['claim', 'confidence', 'test', 'evidence'],
        properties: {
          claim: { type: 'string', description: 'a specific, checkable hypothesis about the user — specific enough to be WRONG' },
          confidence: { type: 'number', description: '0 to 1' },
          test: { type: 'string', description: 'what observable event would confirm or refute this' },
          evidence: { type: 'array', items: { type: 'string' }, description: 'note ids, minimum 2' },
        },
      },
    },
    predictions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['claim', 'horizon_days', 'evidence'],
        properties: {
          claim: { type: 'string', description: 'a dated, falsifiable call about what will happen' },
          horizon_days: { type: 'number', description: 'within how many days it becomes checkable, 1-30' },
          evidence: { type: 'array', items: { type: 'string' }, description: 'note ids, minimum 2' },
        },
      },
    },
  },
};

const SLEEP_SYSTEM = `You are the sleep cycle of a personal AI companion's memory — a psychologist-engineer consolidating field notes into a longitudinal case file. The subject is the app's only user; the file exists solely for their benefit and they can read every word of it in the app.

You receive the current dossier and the active field notes (each with an id, kind, provenance, evidence count ×N, and age). Rewrite the dossier:

1. MERGES — absorb near-duplicate notes into the strongest phrasing (keep_id survives).
2. SUPERSEDE — retire notes that newer evidence contradicts, or that describe states long past. For preferences, recency wins. For claims about what they can or can't do, supersede only with explicit contrary evidence.
3. PATTERNS — this person's recurring loops as trigger → loop → payoff chains, with observable tells and only exits that have actually worked in the notes. Every pattern must cite at least 2 note ids as evidence; patterns citing fewer will be rejected by the app. Max ${MAX_PATTERNS}. This is the core of the file.
4. SUBSTRATE — slow-moving tendencies, stated values, energy rhythms, as hedged behavioral descriptions ("tends to X when Y"), each citing at least 2 note ids. Max ${MAX_SUBSTRATE}.
5. INSIGHTS — 0-3 genuinely NEW higher-level observations that connect notes, each citing at least 2 note ids. Return an empty array if nothing new emerged; forced insights are worse than none.
6. PROFILE — rewrite the distilled read: at most 350 words, written to the companion about the user ("They…"), leading with whatever most helps the companion respond well. Mirror the user's own vocabulary where the notes preserve it.
7. READS — 0-3 NEW hypotheses about the user, mentalist-grade: each must be specific enough to be wrong, cite at least 2 note ids, and carry a "test" naming the observable event that would confirm or refute it. Run the anti-Barnum linter before including one: reject anything that would be true of most people, anything awarding a trait and its opposite, and anything that is unverifiable feel-good filler. Do not re-issue reads already listed as open. Fewer, sharper reads beat many vague ones — an empty array is a fine answer.
8. PREDICTIONS — 0-2 dated, falsifiable calls ("within N days, X"), each citing at least 2 note ids, and only where a mapped pattern makes the call meaningfully better than a coin flip. Your track record is shown to the user; protect it.

Language contract (hard rules): patterns are verbs with contexts, never identity nouns — "tends to defer ambiguous tasks on low-sleep days", never "is an avoider". No diagnostic or clinical labels of any kind. Frame struggles as areas to re-test, not fixed traits. Flattery is not data; discard praise-shaped notes rather than encoding them.`;

function buildInput(sendNotes, aliasOf) {
  const d = dossier.get();
  const lines = sendNotes.map((n) => {
    const age = Math.round((Date.now() - n.ts) / 864e5);
    return `${aliasOf.get(n.id)} · ${n.kind} · ${n.prov} ×${n.ev} · ${age}d — "${n.text}"`;
  });
  let cur = 'CURRENT DOSSIER:\n';
  cur += d.profileText ? `profile: ${d.profileText}\n` : 'profile: (none yet)\n';
  cur += d.patterns.length
    ? 'patterns:\n' + d.patterns.map(p => `- ${p.name}: ${p.trigger} → ${p.loop} → ${p.payoff} (confidence ${p.confidence})`).join('\n') + '\n'
    : 'patterns: (none yet)\n';
  cur += d.substrate.length
    ? 'substrate:\n' + d.substrate.map(s => `- ${s.claim} (confidence ${s.confidence})`).join('\n') + '\n'
    : 'substrate: (none yet)\n';
  const or = openReads();
  cur += or.length
    ? 'open reads (do not re-issue):\n' + or.map(r => `- ${r.claim}`).join('\n') + '\n'
    : '';
  const op = openPredictions();
  cur += op.length
    ? 'open predictions (do not re-issue):\n' + op.map(p => `- ${p.claim}`).join('\n') + '\n'
    : '';
  const cal = calibration();
  if (cal.resolved || cal.confirmed || cal.denied) {
    cur += `track record so far: predictions ${cal.hits}/${cal.resolved} right; reads ${cal.confirmed} confirmed, ${cal.denied} denied by the user\n`;
  }
  const uw = urges.get().log.slice(-15);
  if (uw.length) {
    cur += 'recent urge waves (time · intensity before→after · trigger · outcome):\n' + uw.map((e) => {
      const t = new Date(e.ts);
      return `- ${t.toLocaleDateString([], { weekday: 'short' })} ${String(t.getHours()).padStart(2, '0')}:00 · ${e.before ?? '?'}→${e.after ?? '?'} · ${e.trigger || '?'} · ${e.rode ? 'ridden' : 'stepped away'}`;
    }).join('\n') + '\n';
  }
  return `${cur}\nACTIVE FIELD NOTES:\n${lines.join('\n')}`;
}

// Runs the cycle. Returns {patterns, insights, merged, superseded} counts,
// or throws AIError. Guarded against concurrent runs by the caller.
export async function runSleep() {
  const sendNotes = [...noteStore.active()]
    .sort((a, b) => decayScore(b) - decayScore(a))
    .slice(0, NOTES_CAP);

  // short aliases keep the prompt compact and the model's id-echoing reliable
  const aliasOf = new Map();
  const idOf = new Map();
  sendNotes.forEach((n, i) => {
    const a = 'n' + (i + 1);
    aliasOf.set(n.id, a);
    idOf.set(a, n.id);
  });

  const out = await completeJSON({
    system: SLEEP_SYSTEM,
    messages: [{ role: 'user', content: buildInput(sendNotes, aliasOf) }],
    schema: SLEEP_SCHEMA,
    maxTokens: 8000,
  });

  const real = (alias) => idOf.get(String(alias).trim());
  const validEvidence = (ev) => {
    const ids = (Array.isArray(ev) ? ev : []).map(real).filter(Boolean);
    return [...new Set(ids)];
  };

  // 1. merges — absorbed notes are superseded, survivor soaks up the evidence
  let merged = 0;
  (out.merges || []).forEach((m) => {
    const keepId = real(m.keep_id);
    const keep = keepId && noteStore.get(keepId);
    if (!keep || keep.status !== 'active') return;
    (m.absorb_ids || []).map(real).filter(Boolean).forEach((id) => {
      const n = noteStore.get(id);
      if (!n || n.status !== 'active' || id === keepId) return;
      noteStore.update(id, { status: 'superseded', la: Date.now() });
      noteStore.update(keepId, { ev: keep.ev + n.ev, la: Date.now() });
      merged++;
    });
  });

  // 2. supersede — retired, not deleted (tombstones prevent re-learning)
  let superseded = 0;
  (out.supersede || []).forEach((s) => {
    const id = real(s.id);
    const n = id && noteStore.get(id);
    if (!n || n.status !== 'active') return;
    noteStore.update(id, { status: 'superseded', la: Date.now() });
    superseded++;
  });

  // 3. patterns — the ≥2-evidence rule is the over-generalization guard
  const patterns = (out.patterns || [])
    .map((p) => ({
      name: String(p.name || '').slice(0, 60),
      trigger: String(p.trigger || '').slice(0, 200),
      loop: String(p.loop || '').slice(0, 200),
      payoff: String(p.payoff || '').slice(0, 200),
      tells: (Array.isArray(p.tells) ? p.tells : []).map(t => String(t).slice(0, 80)).slice(0, 4),
      exits: (Array.isArray(p.exits) ? p.exits : []).map(t => String(t).slice(0, 80)).slice(0, 4),
      confidence: Math.min(1, Math.max(0, Number(p.confidence) || 0)),
      evidence: validEvidence(p.evidence),
    }))
    .filter(p => p.name && p.trigger && p.evidence.length >= 2)
    .slice(0, MAX_PATTERNS);

  // 4. substrate — same evidence rule
  const substrate = (out.substrate || [])
    .map(s => ({
      claim: String(s.claim || '').slice(0, 200),
      confidence: Math.min(1, Math.max(0, Number(s.confidence) || 0)),
      evidence: validEvidence(s.evidence),
    }))
    .filter(s => s.claim && s.evidence.length >= 2)
    .slice(0, MAX_SUBSTRATE);

  // 5. insights become visible, deletable field notes like any other
  let insights = 0;
  (out.insights || []).forEach((i) => {
    if (validEvidence(i.evidence).length < 2) return;
    if (typeof i.text !== 'string' || !i.text.trim()) return;
    record({
      text: i.text.trim().slice(0, 240),
      kind: ['pattern', 'trigger', 'state', 'win', 'value', 'fact'].includes(i.kind) ? i.kind : 'pattern',
      imp: 7,
      prov: 'inferred',
      kw: (Array.isArray(i.keywords) ? i.keywords : []).map(k => String(k).toLowerCase()).slice(0, 5),
    });
    insights++;
  });

  // 6. the distilled read
  dossier.patch({
    patterns,
    substrate,
    profileText: String(out.profile || '').slice(0, MAX_PROFILE_CHARS),
    slept: Date.now(),
  });

  // 7-8. reads & predictions — evidence + falsifiability enforced in reads.js
  const newReads = addReads((out.reads || []).map(r => ({ ...r, evidence: validEvidence(r.evidence) })));
  const newPreds = addPredictions((out.predictions || []).map(p => ({ ...p, evidence: validEvidence(p.evidence) })));

  // housekeeping: purge old tombstones/superseded records for good
  const cutoff = Date.now() - TOMBSTONE_DAYS * 864e5;
  noteStore.all()
    .filter(n => n.status !== 'active' && n.la < cutoff)
    .forEach(n => noteStore.remove(n.id));

  sleepMeter.reset();
  return { patterns: patterns.length, insights, merged, superseded, reads: newReads, predictions: newPreds };
}
