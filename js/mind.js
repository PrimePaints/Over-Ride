// mind.js — the personality screening and the matrix it produces.
// The screening documents how the user's mind works; Claude then writes a
// "personality matrix" — persona instructions tuned to exactly what this
// person needs — and that matrix shapes every co-pilot reply from then on.

import { completeJSON } from './ai.js';
import { mind as mindStore, crumbs, vault, portrait, dossier, ago } from './store.js';
import { relevant, rhythmSummary, urgeSummary, OBS_OPEN, OBS_CLOSE } from './notes.js';
import { openReads, openPredictions, calibration, recentSpiral } from './reads.js';

// ---------- The screening ----------
// kind: 'single' → tap one chip (auto-advances), 'multi' → toggle chips,
// 'free' → textarea (mic-enabled).
export const QUESTIONS = [
  {
    id: 'spiral_feel', kind: 'multi',
    q: 'When it hits, what does it feel like in there?',
    sub: 'pick everything that fits',
    options: ['Racing thoughts', 'One thought on a loop', 'Total fog / blank', 'Everything is too loud', 'A shame avalanche', 'Panic in the body', 'Frozen — can’t move'],
  },
  {
    id: 'worse', kind: 'multi',
    q: 'What do people say that makes it WORSE?',
    sub: 'these become hard bans for your co-pilot',
    options: ['“Calm down”', '“Just breathe”', '“Look on the bright side”', '“Have you tried…?”', 'Long explanations', 'Too many questions', 'Pity', 'Being told it’s not a big deal'],
  },
  {
    id: 'helps', kind: 'multi',
    q: 'What actually helps when you’re at 10%?',
    sub: 'be honest, not polite',
    options: ['Distract me', 'One tiny step at a time', 'Validate first, fix later', 'Make me laugh', 'Remind me it passes', 'Just listen, no fixing', 'Give it to me straight'],
  },
  {
    id: 'tone', kind: 'single',
    q: 'Pick the voice you’d actually trust.',
    options: ['Gentle friend', 'Calm and matter-of-fact', 'Dry humor, zero fluff', 'Coach — firm but kind'],
  },
  {
    id: 'length', kind: 'single',
    q: 'How should it talk?',
    options: ['Short bursts only', 'Normal sentences', 'Detail is fine when I ask'],
  },
  {
    id: 'humor', kind: 'single',
    q: 'Humor when things are heavy?',
    options: ['Yes — dark is fine', 'Light humor only', 'No jokes when I’m low'],
  },
  {
    id: 'pushback', kind: 'single',
    q: 'When your brain is lying to you, how much pushback do you want?',
    options: ['Call it out directly', 'Nudge me gently', 'Listen first, challenge later'],
  },
  {
    id: 'focus', kind: 'multi',
    q: 'Where do you want the most backup?',
    options: ['Starting tasks', 'Spirals & overwhelm', 'Remembering things', 'Shutting down at night', 'Self-criticism', 'Making decisions'],
  },
  {
    id: 'about', kind: 'free',
    q: 'Tell it what it should know about you.',
    sub: 'how you talk, what you’re dealing with, what you’re working toward — anything',
  },
  {
    id: 'moment', kind: 'free',
    q: 'Describe one recent moment you wished you’d had backup.',
    sub: 'what happened, and what did you need right then?',
  },
];

// ---------- Matrix synthesis ----------
const MATRIX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['codename', 'summary', 'persona_instructions', 'do', 'dont', 'first_line'],
  properties: {
    codename: { type: 'string', description: 'Short, warm, non-clinical name this co-pilot goes by. 1-3 words. Never "Dr." anything.' },
    summary: { type: 'string', description: '2-4 sentences addressed TO the user describing how the co-pilot will show up for them. Honest and warm, no marketing speak.' },
    persona_instructions: { type: 'string', description: 'System-prompt text written as direct instructions to the co-pilot ("You are…", "You speak in…"). 150-350 words. Concrete and specific to THIS user: their tone pick, humor tolerance, pushback preference, focus areas, and their own words from the free-text answers.' },
    do: { type: 'array', items: { type: 'string' }, description: '5-8 short rules of what to always do, derived from what they said helps.' },
    dont: { type: 'array', items: { type: 'string' }, description: '4-8 short rules of what to never do. Everything they flagged as making things worse goes here as an explicit ban.' },
    first_line: { type: 'string', description: 'The co-pilot’s opening message to the user, in persona. Short. No feature list, no "How can I assist".' },
  },
};

const SYNTH_SYSTEM = `You design personality matrices for "Over-Ride", a cognitive-assistance app for overwhelmed, spiral-prone minds. The app's user has just completed a screening about how their mind works, what helps, and what makes things worse.

From their answers, build the personality matrix for their personal AI co-pilot. The matrix becomes the co-pilot's standing instructions, so make every field earn its place:
- Anything they flagged as making things worse is a hard ban — name those exact phrases and behaviors in "dont".
- Anything they said helps should shape the default behavior in "do".
- Match their chosen tone, reply length, humor tolerance, and pushback level precisely in "persona_instructions".
- Mirror their own vocabulary where it shows up in the free-text answers; people trust a voice that sounds like it listened.
- If the free-text answers reveal a specific struggle or goal, weave it in — the co-pilot should feel like it already knows them.`;

export async function synthesize(answers) {
  const lines = QUESTIONS.map((q) => {
    const a = answers[q.id];
    if (!a || (Array.isArray(a) && !a.length)) return null;
    return `Q: ${q.q}\nA: ${Array.isArray(a) ? a.join('; ') : a}`;
  }).filter(Boolean).join('\n\n');

  return completeJSON({
    system: SYNTH_SYSTEM,
    messages: [{ role: 'user', content: `Screening answers:\n\n${lines || '(the user skipped every question — build a gentle, adaptable default)'}` }],
    schema: MATRIX_SCHEMA,
  });
}

export function saveMatrix(answers, matrix) {
  mindStore.set({ answers, matrix, ts: Date.now() });
}

export function matrix() {
  return mindStore.get()?.matrix || null;
}

export function hasMatrix() {
  return !!matrix();
}

// ---------- The chat system prompt ----------
// Fixed safety core first (the matrix can never override it), then the
// user-calibrated matrix, then a small live-context block from the app.
const SAFETY_CORE = `You are the user's personal co-pilot inside Over-Ride, a crisis-first cognitive assistance app on their phone. They often open it at 10% capacity: spiraling, frozen, blank, or overwhelmed. The user calibrated you themselves through a screening; your personality matrix below was built from their own answers.

What you are: a helpful assistant with perfect context — nothing more pretentious than that. You do the intricate background work of remembering, mapping, and connecting so they can just live their life with backup. You are not a life coach, mentor, or therapist and you never perform as one: no frameworks, no growth-journey speak, no unsolicited programs for self-improvement. Help sounds like a capable aide who knows the file — "you said Thursdays work better" — never like a counselor's intervention.

Hard rules that override everything below:
- You are a supportive companion, not a therapist or doctor. No diagnoses, no medication advice. If something needs deeper help, say so kindly and encourage a professional.
- If they express intent to harm themselves or someone else, drop the persona: respond with warmth, take it seriously, and encourage reaching out right now — a trusted person, local emergency services, or a crisis line (in South Africa: SADAG 0800 567 567, or SMS 31393).
- Default to SHORT replies, 1-4 sentences. They may barely be able to read right now. Go longer only when clearly asked.
- Plain language. No lectures, no bullet-point essays, no "as an AI".
- Never shame them or imply they're broken. The brain is the weather, not the person.`;

const OBS_PROTOCOL = `FIELD NOTES PROTOCOL (invisible to the user — the app strips it before display):
After your reply, on a new line, append exactly: ${OBS_OPEN}[…]${OBS_CLOSE}
The array holds 0-2 observation objects: {"text": one specific observation about the user, "kind": "pattern"|"trigger"|"state"|"win"|"value"|"fact", "importance": 1-10 (1 = mundane, 10 = core insight), "provenance": "stated" (they said it outright) or "inferred" (you deduced it), "keywords": [2-5 lowercase words]}
Rules for what counts as a note:
- Only what THIS exchange evidenced. Cite behavior or their words, not vibes.
- Record events, never identities: "deferred the supplier email a 3rd time" — not "is an avoider".
- Never record your own advice or claims as facts about them. Never record praise or agreement as a trait.
- Watch especially for: triggers and what made a task aversive (ambiguity, boredom, being judged), avoidance moves and what relief they bought, spiral tells, intention-vs-action gaps, what actually helped, wins, stated values.
- Most exchanges deserve zero or one note. Empty is normal: ${OBS_OPEN}[]${OBS_CLOSE}`;

function vaultSummary() {
  const items = vault.all();
  const open = items.filter(i => !i.done);
  if (!items.length) return null;
  let s = `${open.length} open item${open.length === 1 ? '' : 's'}, ${items.length - open.length} done`;
  if (open.length) {
    const oldest = open.reduce((a, b) => (a.ts < b.ts ? a : b));
    s += `; oldest open: “${oldest.title}” (${ago(oldest.ts)})`;
  }
  return s;
}

export function chatSystem(latestMsg = '') {
  const m = matrix();
  let sys = SAFETY_CORE;

  if (m) {
    sys += `\n\nYOUR PERSONALITY MATRIX (calibrated by the user):\nYou go by “${m.codename}”.\n${m.persona_instructions}` +
      `\n\nAlways:\n${m.do.map(d => '- ' + d).join('\n')}` +
      `\n\nNever:\n${m.dont.map(d => '- ' + d).join('\n')}`;
  }

  const self = (portrait.get() || '').trim();
  if (self) {
    sys += `\n\nSELF-PORTRAIT (written by the user, in their own words — never contradict it, never rewrite it):\n${self.slice(0, 600)}`;
  }

  // The distilled read + mapped patterns, written by the sleep cycle.
  const d = dossier.get();
  if (d.profileText) {
    sys += `\n\nDOSSIER (distilled by your sleep cycle from accumulated field notes; hypotheses to keep testing, not verdicts):\n${d.profileText}`;
  }
  if (d.patterns.length) {
    const top = [...d.patterns].sort((a, b) => b.confidence - a.confidence).slice(0, 6);
    sys += `\n\nPATTERNS YOU'VE MAPPED (trigger → loop → payoff):` + top.map(p =>
      `\n- ${p.name} (confidence ${Math.round(p.confidence * 100)}%, ${p.evidence.length} notes): ${p.trigger} → ${p.loop} → ${p.payoff}` +
      (p.tells.length ? ` | tells: ${p.tells.join('; ')}` : '') +
      (p.exits.length ? ` | exits that worked: ${p.exits.join('; ')}` : '')).join('');
  }

  // The File: telemetry + the field notes most relevant to this message.
  const parts = [];
  const rhythmLine = rhythmSummary();
  if (rhythmLine) parts.push(`- Rhythm: ${rhythmLine}`);
  const urgeLine = urgeSummary();
  if (urgeLine) parts.push(`- Urge waves: ${urgeLine}`);
  const vaultLine = vaultSummary();
  if (vaultLine) parts.push(`- Vault: ${vaultLine}`);
  const notes = relevant(latestMsg, 5);
  if (notes.length) {
    parts.push('- Field notes relevant right now:' + notes.map(n =>
      `\n  · [${n.prov}${n.ev > 1 ? ` ×${n.ev}` : ''}, ${ago(n.ts)}] ${n.text}`).join(''));
  }
  if (parts.length) {
    sys += `\n\nTHE FILE (your accumulated field intelligence — the user can read and edit all of it in The File screen; treat inferred notes as hypotheses to re-test, not facts):\n${parts.join('\n')}`;
  }

  // the mentalist layer: open reads, open predictions, and the track record
  const or = openReads();
  const op = openPredictions();
  const cal = calibration();
  if (or.length || op.length || cal.resolved) {
    sys += '\n\nYOUR MENTALIST LEDGER:';
    if (or.length) {
      sys += `\n- Open reads (hypotheses the user hasn't ruled on — you may voice ONE when the moment is calm and it's genuinely relevant, always with its receipts, phrased as a guess to check, never as a verdict):` +
        or.map(r => `\n  · ${r.claim} (${Math.round(r.confidence * 100)}%)`).join('');
    }
    if (op.length) {
      sys += `\n- Open predictions you've made:` + op.map(p => `\n  · ${p.claim}`).join('');
    }
    if (cal.resolved || cal.confirmed || cal.denied) {
      sys += `\n- Track record (the user can see this too): predictions ${cal.hits}/${cal.resolved} right; reads ${cal.confirmed} confirmed, ${cal.denied} denied. Protect it — no shotgunning.`;
    }
  }

  const recent = crumbs.recent(4).map(c => `- ${c.text} (${ago(c.ts)})`).join('\n');
  sys += `\n\nLIVE CONTEXT (right now):\n- Local time: ${new Date().toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' })}` +
    `\n${recent ? '- Recent app activity:\n' + recent : '- No recent app activity.'}`;

  if (recentSpiral()) {
    sys += `\n- ⚠ They hit a spiral within the last half hour. Stabilization first: ground, shrink, hand them one step. No reads, no pattern analysis, no predictions right now unless they explicitly ask.`;
  }

  sys += `\n\n${OBS_PROTOCOL}`;
  return sys;
}
