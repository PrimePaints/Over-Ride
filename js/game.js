// game.js — water-sort: the dead-simple spatial puzzle that hijacks working memory.
// Tap a tube to lift it, tap another to pour. Sort every color into its own tube.

const PALETTE = ['#ff5f6d', '#38d0f2', '#ffd23f', '#7cf29b', '#c17ef5', '#ff9f43', '#4b7bec'];
const CAP = 4;

// One-time "how to play" overlay, injected over the game container.
// The caller owns the seen-flag; onDone fires when dismissed.
export function gameHelp(container, onDone) {
  const ov = document.createElement('div');
  ov.className = 'game-help';

  const h = document.createElement('p');
  h.className = 'gh-title';
  h.textContent = '🧪 How the tubes work';

  const ul = document.createElement('ul');
  [
    'Tap a tube to lift it, then tap another tube to pour.',
    'A colour only pours onto the SAME colour — or into an empty tube.',
    'Only the top blob pours. Tubes hold 4.',
    'Goal: every colour in its own tube.',
  ].forEach((t) => {
    const li = document.createElement('li');
    li.textContent = t;
    ul.appendChild(li);
  });

  const btn = document.createElement('button');
  btn.className = 'pill-btn';
  btn.textContent = 'Got it →';
  btn.addEventListener('click', () => {
    ov.remove();
    onDone && onDone();
  });

  ov.append(h, ul, btn);
  container.appendChild(ov);
  btn.focus();
}

export class WaterSort {
  constructor(el, { onPour, onWin } = {}) {
    this.el = el;
    this.onPour = onPour || (() => {});
    this.onWin = onWin || (() => {});
    this.tubes = [];
    this.selected = -1;
    this.solves = 0;
    this.locked = false;
    this.winTimer = null;
    const onTap = (e) => {
      const t = e.target.closest('.tube');
      if (t) this.tap(parseInt(t.dataset.i, 10));
    };
    this.el.addEventListener('click', onTap);
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(e); }
    });
  }

  newPuzzle() {
    clearTimeout(this.winTimer);
    const colors = Math.min(4 + Math.floor(this.solves / 2), 5);
    this.tubes = generate(colors);
    this.selected = -1;
    this.locked = false;
    this.render();
  }

  // Cancel pending work (the win celebration's queued newPuzzle) on exit.
  stop() {
    clearTimeout(this.winTimer);
    this.winTimer = null;
  }

  tap(i) {
    if (this.locked) return;
    if (this.selected === -1) {
      if (this.tubes[i].length > 0) {
        this.selected = i;
        this.updateSelection();
      }
      return;
    }
    if (this.selected === i) {
      this.selected = -1;
      this.updateSelection();
      return;
    }
    if (canPour(this.tubes, this.selected, i)) {
      const from = this.selected;
      pour(this.tubes, from, i);
      this.selected = -1;
      this.onPour();
      this.updateTube(from);
      this.updateTube(i);
      this.updateSelection();
      if (isSolved(this.tubes)) {
        this.locked = true;
        this.solves++;
        this.onWin();
        this.winTimer = setTimeout(() => this.newPuzzle(), 1400);
      }
    } else {
      // illegal pour: re-select the tapped tube instead of punishing
      this.selected = this.tubes[i].length > 0 ? i : -1;
      this.updateSelection();
    }
  }

  render() {
    this.el.innerHTML = '';
    this.tubes.forEach((tube, i) => {
      const t = document.createElement('div');
      t.className = 'tube' + (i === this.selected ? ' selected' : '');
      t.dataset.i = i;
      t.setAttribute('role', 'button');
      t.setAttribute('tabindex', '0');
      this.fillTube(t, tube, i);
      this.el.appendChild(t);
    });
  }

  fillTube(t, tube, i) {
    t.innerHTML = '';
    t.setAttribute('aria-label', `Tube ${i + 1}, ${tube.length} of ${CAP} full`);
    tube.forEach(c => {
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.style.background = PALETTE[c];
      t.appendChild(seg);
    });
  }

  // In-place updates keep the same DOM nodes so the CSS lift transition runs.
  updateSelection() {
    [...this.el.children].forEach((t, i) => t.classList.toggle('selected', i === this.selected));
  }

  updateTube(i) {
    const t = this.el.children[i];
    if (t) this.fillTube(t, this.tubes[i], i);
  }
}

// ---------- pure puzzle logic ----------

function topRun(tube) {
  if (!tube.length) return { color: -1, count: 0 };
  const color = tube[tube.length - 1];
  let count = 0;
  for (let i = tube.length - 1; i >= 0 && tube[i] === color; i--) count++;
  return { color, count };
}

function canPour(tubes, from, to) {
  if (from === to) return false;
  const src = tubes[from], dst = tubes[to];
  if (!src.length || dst.length >= CAP) return false;
  const { color } = topRun(src);
  if (dst.length && dst[dst.length - 1] !== color) return false;
  // pointless: moving a complete uniform tube into an empty tube
  if (!dst.length && src.length === CAP && src.every(c => c === color)) return false;
  return true;
}

function pour(tubes, from, to) {
  const src = tubes[from], dst = tubes[to];
  const { color, count } = topRun(src);
  const space = CAP - dst.length;
  const n = Math.min(count, space);
  for (let i = 0; i < n; i++) {
    src.pop();
    dst.push(color);
  }
}

function isSolved(tubes) {
  return tubes.every(t => t.length === 0 || (t.length === CAP && t.every(c => c === t[0])));
}

// Generate a random layout, then verify it's actually solvable (DFS with a node
// budget). Handing a panicking person an unsolvable puzzle would be cruel.
function generate(nColors) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const units = [];
    for (let c = 0; c < nColors; c++) for (let k = 0; k < CAP; k++) units.push(c);
    shuffle(units);
    const tubes = [];
    for (let i = 0; i < nColors; i++) tubes.push(units.slice(i * CAP, i * CAP + CAP));
    tubes.push([], []); // two empty tubes
    if (!isSolved(tubes) && solvable(tubes)) return tubes;
  }
  // fallback: an easy known-solvable layout
  const tubes = [];
  for (let c = 0; c < nColors; c++) tubes.push([c, c, c, c]);
  tubes.push([], []);
  // scramble with legal reverse moves
  for (let i = 0; i < 30; i++) {
    const from = Math.floor(Math.random() * tubes.length);
    const to = Math.floor(Math.random() * tubes.length);
    if (from !== to && tubes[from].length && tubes[to].length < CAP) {
      tubes[to].push(tubes[from].pop());
    }
  }
  return solvable(tubes) && !isSolved(tubes) ? tubes : generateTrivial(nColors);
}

function generateTrivial(nColors) {
  // one swap away from solved — guaranteed solvable, better than a broken board
  const tubes = [];
  for (let c = 0; c < nColors; c++) tubes.push([c, c, c, c]);
  tubes.push([], []);
  tubes[1].push(tubes[0].pop());
  tubes[0].push(tubes[2].pop());
  tubes[2].push(tubes[1].pop());
  return tubes;
}

function solvable(startTubes) {
  const seen = new Set();
  let budget = 60000;
  const key = (tubes) => tubes.map(t => t.join(',')).sort().join('|');

  function dfs(tubes) {
    if (budget-- <= 0) return false;
    if (isSolved(tubes)) return true;
    const k = key(tubes);
    if (seen.has(k)) return false;
    seen.add(k);
    for (let from = 0; from < tubes.length; from++) {
      for (let to = 0; to < tubes.length; to++) {
        if (!canPour(tubes, from, to)) continue;
        const next = tubes.map(t => [...t]);
        pour(next, from, to);
        if (dfs(next)) return true;
      }
    }
    return false;
  }
  return dfs(startTubes.map(t => [...t]));
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}
