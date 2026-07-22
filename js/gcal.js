// gcal.js — calendar context from two Google accounts (personal + work),
// authorized with Google Identity Services entirely in the browser. One
// OAuth Client ID, two sign-ins; tokens and the cached agenda live on this
// device like everything else. Events are tagged [personal] / [work].

import { gcal as store } from './store.js';

const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email';
const STALE_MS = 15 * 60e3;   // agenda refresh cadence
const LOOKAHEAD_H = 48;
export const SLOTS = ['personal', 'work'];

// ---------- Google Identity Services loader ----------
let gisPromise = null;
function loadGIS() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    let settled = false;
    const done = (ok, err) => {
      if (settled) return;
      settled = true;
      if (ok) resolve();
      else { gisPromise = null; reject(err); }
    };
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => done(true);
    s.onerror = () => done(false, new Error("Couldn't load Google sign-in — are you online?"));
    document.head.appendChild(s);
    setTimeout(() => done(false, new Error('Google sign-in timed out — try again.')), 8000);
  });
  return gisPromise;
}

// ---------- connect / disconnect ----------
export async function connect(slot) {
  const { clientId } = store.get();
  if (!clientId) throw new Error('Add your Google OAuth Client ID above first.');
  await loadGIS();
  const prev = store.get().accounts[slot];

  return new Promise((resolve, reject) => {
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      hint: prev?.email || undefined,
      prompt: prev ? '' : 'select_account',
      callback: async (resp) => {
        if (!resp || resp.error) {
          reject(new Error(resp?.error === 'access_denied' ? 'Sign-in was cancelled.' : `Google sign-in failed (${resp?.error || 'no response'}).`));
          return;
        }
        const token = resp.access_token;
        const exp = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
        let email = prev?.email || '';
        try {
          const u = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: 'Bearer ' + token },
          });
          if (u.ok) email = (await u.json()).email || email;
        } catch { /* keep previous label */ }
        store.setAccount(slot, { email, token, exp });
        try { await refreshEvents({ force: true }); } catch { /* agenda fills in later */ }
        resolve(email);
      },
    });
    tc.requestAccessToken();
  });
}

export function disconnect(slot) {
  store.setAccount(slot, null);
  const g = store.get();
  store.patch({ events: g.events.filter(e => e.cal !== slot) });
}

// ---------- agenda fetch ----------
export async function refreshEvents({ force = false } = {}) {
  const g = store.get();
  if (!force && Date.now() - g.fetched < STALE_MS) return g.events;

  const merged = [];
  let fetchedAny = false;
  for (const slot of SLOTS) {
    const acc = store.get().accounts[slot];
    if (!acc) continue;
    if (acc.exp < Date.now()) continue; // token lapsed — needs a reconnect tap
    try {
      const timeMin = encodeURIComponent(new Date().toISOString());
      const timeMax = encodeURIComponent(new Date(Date.now() + LOOKAHEAD_H * 36e5).toISOString());
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=15&singleEvents=true&orderBy=startTime&timeMin=${timeMin}&timeMax=${timeMax}`,
        { headers: { Authorization: 'Bearer ' + acc.token } },
      );
      if (res.status === 401 || res.status === 403) {
        store.setAccount(slot, { ...acc, exp: 0 }); // surface as "reconnect"
        continue;
      }
      if (!res.ok) continue;
      const data = await res.json();
      (data.items || []).forEach((e) => {
        if (e.status === 'cancelled') return;
        merged.push({
          cal: slot,
          title: (e.summary || '(untitled)').slice(0, 80),
          start: e.start?.dateTime || e.start?.date || '',
          allDay: !e.start?.dateTime,
          loc: (e.location || '').slice(0, 60),
        });
      });
      fetchedAny = true;
    } catch { /* offline — keep the cached agenda */ }
  }

  if (fetchedAny) {
    merged.sort((a, b) => a.start.localeCompare(b.start));
    store.patch({ events: merged, fetched: Date.now() });
  }
  return store.get().events;
}

// ---------- views ----------
export function status() {
  const g = store.get();
  const out = {};
  SLOTS.forEach((slot) => {
    const acc = g.accounts[slot];
    if (!acc) out[slot] = { state: 'off' };
    else if (acc.exp < Date.now()) out[slot] = { state: 'expired', email: acc.email };
    else out[slot] = { state: 'ok', email: acc.email };
  });
  return out;
}

export function hasAnyAccount() {
  const a = store.get().accounts;
  return !!(a.personal || a.work);
}

export function agendaLines(limit = 8) {
  return store.get().events.slice(0, limit).map((e) => {
    const d = new Date(e.start);
    const day = d.toLocaleDateString([], { weekday: 'short' });
    const time = e.allDay ? 'all day' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `[${e.cal}] ${e.title} — ${day} ${time}${e.loc ? ' @ ' + e.loc : ''}`;
  });
}
