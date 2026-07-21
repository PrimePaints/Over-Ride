// store.js — everything stays on-device, in localStorage.

const KEY = 'override-v1';

const DEFAULTS = {
  settings: { voice: true, haptics: true, noise: 'brown', volume: 60 },
  ai: { apiKey: '', model: 'claude-opus-4-8' },
  mind: null,       // {answers, matrix, ts} — the co-pilot's personality matrix
  chat: [],         // {role, text, ts} — co-pilot conversation, capped at 40
  notes: [],        // field notes {id, ts, la, text, kind, imp, prov, ev, status, kw}
  selfPortrait: '', // user-authored, the AI never writes here
  rhythm: { hourly: new Array(24).fill(0), spirals: new Array(24).fill(0) },
  lastHarvest: 0,   // ts of the newest crumb already harvested into telemetry
  vault: [],        // {id, ts, type, title, extra, done}
  crumbs: [],       // {ts, text} — passive context breadcrumbs for the Retracer
  streak: 0,        // lifetime micro-steps completed
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    const rhythm = parsed.rhythm || {};
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
      ai: { ...DEFAULTS.ai, ...(parsed.ai || {}) },
      rhythm: {
        hourly: Array.isArray(rhythm.hourly) && rhythm.hourly.length === 24 ? rhythm.hourly : new Array(24).fill(0),
        spirals: Array.isArray(rhythm.spirals) && rhythm.spirals.length === 24 ? rhythm.spirals : new Array(24).fill(0),
      },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full/blocked — keep running in memory */ }
}

export const settings = {
  get: (k) => state.settings[k],
  set: (k, v) => { state.settings[k] = v; save(); },
  all: () => ({ ...state.settings }),
};

export const vault = {
  add(item) {
    const entry = { id: Date.now() + Math.random().toString(16).slice(2), ts: Date.now(), done: false, ...item };
    state.vault.unshift(entry);
    save();
    return entry;
  },
  all: () => [...state.vault],
  toggle(id) {
    const it = state.vault.find(i => i.id === id);
    if (it) { it.done = !it.done; save(); }
  },
  clearDone() {
    state.vault = state.vault.filter(i => !i.done);
    save();
  },
};

export const ai = {
  get: (k) => state.ai[k],
  set: (k, v) => { state.ai[k] = v; save(); },
};

export const mind = {
  get: () => state.mind,
  set(m) { state.mind = m; save(); },
  clear() { state.mind = null; save(); },
};

export const chat = {
  all: () => [...state.chat],
  push(role, text) {
    state.chat.push({ role, text, ts: Date.now() });
    state.chat = state.chat.slice(-40);
    save();
  },
  clear() { state.chat = []; save(); },
};

export const notes = {
  all: () => [...state.notes],
  active: () => state.notes.filter(n => n.status === 'active'),
  get: (id) => state.notes.find(n => n.id === id),
  add(n) { state.notes.push(n); save(); },
  update(id, patch) {
    const n = state.notes.find(x => x.id === id);
    if (n) { Object.assign(n, patch); save(); }
  },
  remove(id) { state.notes = state.notes.filter(n => n.id !== id); save(); },
};

export const portrait = {
  get: () => state.selfPortrait,
  set(v) { state.selfPortrait = v; save(); },
};

export const rhythm = {
  get: () => ({ hourly: [...state.rhythm.hourly], spirals: [...state.rhythm.spirals] }),
  bump(hour, spiral) {
    if (hour < 0 || hour > 23) return;
    state.rhythm.hourly[hour]++;
    if (spiral) state.rhythm.spirals[hour]++;
    save();
  },
};

export const harvestMark = {
  get: () => state.lastHarvest,
  set(ts) { state.lastHarvest = ts; save(); },
};

export const crumbs = {
  log(text) {
    state.crumbs.unshift({ ts: Date.now(), text });
    state.crumbs = state.crumbs.slice(0, 30);
    save();
  },
  recent: (n = 6) => state.crumbs.slice(0, n),
};

export const streak = {
  bump() { state.streak++; save(); return state.streak; },
  get: () => state.streak,
};

export function wipeAll() {
  state = structuredClone(DEFAULTS);
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
