# mu.gen

A free, open-source (GPLv3) generative music app. It runs on the web and ships to iOS and Android through Capacitor. Music is composed in real time in the browser with Tone.js.

The code currently in the repo is an early prototype that is being replaced. Design, features and structure will change, so don't treat existing code as architecture to preserve.

## Stack

- Vite + npm
- Tone.js, imported from npm (`import * as Tone from "tone"`), never from a CDN or a global
- Vanilla JS with ES modules (no UI framework yet)
- Capacitor for iOS and Android

## Architecture

Layout: `src/main.js` is the only place engine, platform and UI are wired together. `src/engine/` (store, mixer, engine), `src/ui/`, `src/platform/` (web implementation; Capacitor would add or replace here).

- **`engine/`**: generation, arrangement, instruments, routing. No DOM and no Capacitor code, so it can run and be tested without a UI.
- **`ui/`**: rendering and input. It talks to the engine only through a small state/command interface, never to synths or Tone objects directly. The engine never imports UI code.
- **`platform/`**: the only place that touches Capacitor or other platform APIs (background audio, media controls). Everything else asks this layer.
- Keep the master audio output routable to an `<audio>` element. Mobile background playback may depend on it.

## Code style

Comments are rare and short: lowercase, one line, only where something isn't obvious from the code (a constraint, a gotcha, a non-obvious why). Never restate what the code does, and no docblocks, section banners or explanatory paragraphs. Let names and structure carry the meaning.

## Open decisions

Ask the owner rather than assuming: the sound goal and feature set, whether user accounts exist (at most minimal preset storage), and the visual design.

## Audio design

- **Real-time synthesis** with the composition planned ahead of the audio clock. A composer layer produces timed events roughly 10-15 seconds ahead (the most the user can tolerate while still feeling in control), and a synth layer plays them through the live audio graph. Textures (noise, filters, LFOs) run inside the graph and need no JS timers.
- The planned queue must stay mutable: only the next second or two is frozen, so a parameter change re-plans the rest. Graph parameters (filters, send levels) respond instantly.
- The composer is seeded and deterministic, so presets and saved moments can be small sets of numbers.
- Output goes through a mixer with shared effect buses (a few reverbs/delays that instruments send to), not per-instrument effects.
- The track is organized in sections and evolves slowly within the region defined by the user's parameters.
- Endless generative playback is the product. Finite tracks are out of scope.

## Main technical risk: background audio

Mobile webviews can suspend audio and throttle timers when the app is backgrounded or the screen is locked. The live engine must survive that on real devices.

Findings so far (iOS Safari, `spike/`): with both `navigator.audioSession.type = "playback"` and master output routed through an `<audio>` element (via `MediaStreamDestination`) with Media Session metadata, a real-time Tone.js engine kept playing for about 15 minutes (mostly screen locked) with the planner's worst timer gap flat at 2.0s against a 12s lookahead. Not yet verified: which of the two measures is required, Android, and behavior inside the Capacitor shell.

Fallback if this stops holding: render audio in chunks with `Tone.Offline` and play them through an `<audio>` element or native player.

`spike/` is a throwaway test page, not part of the app architecture.

## Commands

- `npm run dev`: Vite dev server on the network (`--host`), so it can be opened on a phone. The audio spike is at `/spike/`.
- `npm run build`: production build.
- `npx cap sync`: copies the web build into native projects once Capacitor is added (not set up yet).
