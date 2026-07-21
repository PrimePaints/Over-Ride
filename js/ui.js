// ui.js — small shared helpers.

export const $ = (sel) => document.querySelector(sel);

export function confetti(n = 60) {
  const colors = ['#ff5f6d', '#38d0f2', '#ffd23f', '#7cf29b', '#c17ef5', '#ff9f43'];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.4 + Math.random() * 1.6 + 's';
    c.style.animationDelay = Math.random() * 0.4 + 's';
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3600);
  }
}

// Attach mic dictation to an input: toggles listening, appends final text.
import { listen, stopListening, sttSupported } from './speech.js';

export function wireMic(micBtn, onText) {
  if (!sttSupported) {
    micBtn.classList.add('unsupported');
    micBtn.title = 'Voice input not supported in this browser — typing works!';
    micBtn.addEventListener('click', () => {
      micBtn.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 200 });
    });
    return;
  }
  let ctl = null;
  micBtn.addEventListener('click', () => {
    if (ctl) { ctl.stop(); return; }
    micBtn.classList.add('listening');
    ctl = listen({
      onText,
      onEnd: () => { ctl = null; micBtn.classList.remove('listening'); },
    });
    if (!ctl) micBtn.classList.remove('listening');
  });
}

export { stopListening };
