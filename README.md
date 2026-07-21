# Over-Ride 🌀

**Intervention-first cognitive assistance.** Most productivity apps assume you're operating at 100% capacity. Over-Ride assumes you're at 10%, overwhelmed, and about to shut down.

No calendar. No overdue-task guilt. No menus. The home screen is four massive buttons based entirely on your current state of failure:

| Button | State | What happens |
|---|---|---|
| 🫥 **I Forgot** | Blank / doorway effect | The **Retracer** — voice-guided rapid-fire grounding questions + a "clues" panel built from your recent activity breadcrumbs |
| 🌀 **I'm Spiraling** | Overwhelm / rumination | The **Defibrillator** — screen goes dark, brown noise fades in, heartbeat haptics pulse, then a 60-second water-sort puzzle hijacks your working memory. Then the co-pilot gently hands you back: *"Okay, the spiral is broken. What were we trying to do?"* |
| 🧊 **I'm Stuck** | Paralysis / can't start | The **Micro-Stepper** — the task becomes comically small steps ("Stand up. That's the whole step."), revealed strictly one at a time, with sound + haptic rewards. It gamifies momentum, not completion |
| 🗣️ **Brain Dump** | Working memory overload | The **External Brain** — tap, speak everything unsorted, and the on-device rule engine files it into errands, reminders, health log, drafts, ideas. Then: *"Out of your head. Return to what you were doing."* |

## Try it

It's a static, dependency-free PWA — any static file server works:

```bash
cd Over-Ride
python3 -m http.server 8080
# open http://localhost:8080 (or your machine's LAN IP from your phone)
```

**Deploy to GitHub Pages** (recommended for phone use): in the repo, go to
*Settings → Pages → Source: GitHub Actions*. The included workflow
(`.github/workflows/pages.yml`) deploys on every push to `main`. Then open the
Pages URL on your phone and **Add to Home Screen** — it installs as a
full-screen app and works fully offline afterwards.

> HTTPS (or localhost) is required for the microphone, service worker, and
> installation — GitHub Pages gives you that for free.

## Design principles

- **Zero-friction triage.** One tap from open to intervention. Every screen is escapable in one tap. Nothing punishes you; stopping is always "allowed."
- **Sensory override, not advice.** During a spiral, words are the enemy. The Defibrillator occupies your visual (puzzle), auditory (brown noise), and tactile (heartbeat haptics that slowly decelerate ~75→52 bpm) channels simultaneously so the spiral is starved of resources.
- **Everything on-device.** localStorage only. Nothing is uploaded, ever. The "AI" co-pilot is a local rule engine — private, offline, instant, and never down when you need it at 3am.
- **Works with zero signal.** Service worker caches the whole app shell; a crisis app must not depend on connectivity.

## Platform notes

| Capability | Android (Chrome) | iOS (Safari) |
|---|---|---|
| Brown/pink/rain noise (Web Audio, synthesized) | ✅ | ✅ |
| Voice co-pilot (speech synthesis) | ✅ | ✅ |
| Voice input (speech recognition) | ✅ | ✅ iOS 14.5+ (needs Siri enabled) |
| Heartbeat haptics (`navigator.vibrate`) | ✅ | ❌ silently skipped — everything else still works |
| Install to home screen / offline | ✅ | ✅ (Share → Add to Home Screen) |

## Architecture

```
index.html            all screens, no framework
css/style.css         dark-first, huge touch targets, reduced-motion aware
js/main.js            router + vault + settings
js/defib.js           I'm Spiraling — ground → puzzle → AI hand-off
js/retrace.js         I Forgot — question script + clues from breadcrumbs
js/stepper.js         I'm Stuck — one-step-at-a-time with rewards
js/dump.js            Brain Dump — capture → parse → file
js/brain.js           the local rule engine (parser, breakdowns, scripts)
js/game.js            water-sort puzzle w/ solvability-verified generator
js/audio.js           procedural noise + reward sounds (no audio files)
js/haptics.js         heartbeat rhythm + buzzes
js/speech.js          TTS + STT wrappers with graceful fallbacks
js/store.js           localStorage: settings, vault, context breadcrumbs
sw.js                 cache-first offline shell
```

The rule engine (`js/brain.js`) is the single seam for intelligence: `parseDump()`, `breakdown()`, and the script tables. Swapping in an LLM later means replacing those three functions — the UX contract stays identical.
