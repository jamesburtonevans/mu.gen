# mu.gen

Free, open-source (GPLv3) generative music app: endless, calm music for focus, sleep, relaxing and meditating, composed and synthesised live in the browser from a seed and ten user controls. No AI or trained model: composition is rule-based and all randomness comes from a seeded generator. It runs on the web now; iOS and Android via Capacitor are planned (not set up).

## Commands

- `npm install`, then `npm run dev`: Vite dev server on the network (`--host`) so a phone can open it.
- `npm run build`: production build into `dist/`. It only proves the modules parse; load the page and press Play to catch runtime errors.
- No test suite or linter. See "Verifying changes".

Stack: Vite, vanilla JS ES modules, no UI framework. Tone.js from npm (`import * as Tone from "tone"`, never a CDN or global). `standardized-audio-context` is imported directly so the context can be created at a chosen sample rate.

## Architecture

```
main.js          wires everything; the only file that imports engine, platform and ui together
engine/          audio and music, no DOM, no Capacitor, never imports ui/
ui/              DOM rendering and input; talks to the engine only via the store and commands from main.js
platform/        browser/native services (output element, Media Session, storage); the only place for Capacitor code
```

| File | Role |
|---|---|
| `engine/engine.js` | `createEngine()`: planning loop, start/stop/pause/resume, sleep timer, presets, store, watchdog |
| `engine/params.js` | Axes, emotion recipes, mapping table, internals, `resolve()`, `restoreAxes/Internals` |
| `engine/presets.js` | Built-in presets (plain data) |
| `engine/composer.js` | Pure planner: resolved params to timed events, bar by bar (`applyFeeling` applies the emotion recipe) |
| `engine/theory.js`, `meter.js`, `genome.js`, `rng.js` | Pure helpers: modes, chord schemata, cadences; meters; instrument gene specs and per-seed style (`drawStyle`); seeded RNG |
| `engine/dsp.js`, `voices.js`, `texture.js`, `reverb.js` | Offline rendering of instrument buffers, noise beds and reverb impulse responses (pure, no audio context) |
| `engine/renderer.js`, `render.worker.js`, `renderers.js` | Runs those renders in a worker, one at a time; `inlineRenderer` for tools |
| `engine/instruments.js` | Plays rendered buffers through native Web Audio nodes: `ROLES` table, voices, macros, evolution, voice caps |
| `engine/mixer.js` | Channels, reverb and delay buses, master chain, volume, fades, output inspection |
| `engine/store.js` | Observable state: `get`, `set(patch)`, `subscribe(fn)` (calls fn immediately) |
| `platform/web.js` | Hidden `<audio>` element fed by the master output, Media Session, audio session type |
| `platform/settings.js`, `platform/presets.js` | localStorage persistence (`mugen.settings.v1`, `mugen.presets.v1`) |
| `ui/app.js`, `ui/labels.js`, `ui/style.css` | Rendering (axes are rendered generically), display text, styles |

### Engine API (what `main.js` and the UI may use)

`createEngine({ initial, onSleep })` returns `store`, `axes`, `internals`, `noteNames`, `output` (the master node to route out), `context`, and the commands `start()`, `stop()`, `pause({ immediate })`, `resume()`, `setAxis(name, value)`, `setInternal(name, value)`, `regenerate()`, `snapshot()`, `applyPreset(preset)`, `clearPreset()`, `markPreset(preset)`, `setVolume(v)`, `setSleep(minutes)`. Anything else is internal.

### Control flow

1. A control changes (axis, internal, preset). The engine updates the store, calls `resolve(axes, internals)`, slews graph parameters over about 3 s (`SLEW_S`) and re-plans the uncommitted part of the composition.
2. Every second `tick()` plans to 12 s ahead (`PLAN_S`) and commits the next 5 s (`COMMIT_S`) to the audio graph. Committed events are frozen; the rest is dropped and re-planned on a change (`composer.rewindTo` restores a bar-start snapshot). The composer works in absolute audio-clock seconds, not `Tone.Transport`.
3. Events sent to `instruments.js`:
   - note: `{ layer, time, duration, velocity, midi | midis, pan, ... }`
   - `bar`: `{ time, section, meter, tempo, tonicPc, mode }` (readout and delay time)
   - `macro`: slow per-role timbre and motion change (mean-reverting random walk)
   - `voice`: small mutation of a role's gene at a section change

### Sound generation

Sounds are rendered offline, not synthesised live, and never on the main thread. `voices.js`, `texture.js` and `dsp.js` render each sound into samples from a gene (flat continuous parameters with ranges, `SPECS` in `genome.js`); `instruments.js` plays them as `AudioBuffer`s with per-hit pitch, level, pan and glide. This keeps audio-thread CPU low for hours. A render takes tens to hundreds of ms (several times that on a phone), and main-thread stalls make output choppy because it reaches the `<audio>` element through a media stream, so all renders run in a worker (`renderer.js`, `render.worker.js`, function table in `renderers.js`), one at a time. Instruments ask for sounds with `c.render(role, key, () => [rendererName, args])`. A sound that is not ready is waited for (the note plays when it arrives, if still in time), and after a role evolves its old sounds keep serving until the new render lands. Never call a `render*` function from the main thread in engine code; offline harnesses pass no renderer and get the synchronous `inlineRenderer`. Instruments are rebuilt on every start, and a new seed rebuilds everything.

Roles: `pad`, `bass`, `lead`, `bell`, `arp`, `kick`, `hat`, `perc`; occasional `sparkle`, `drip`, `reed`; texture roles `ambience` (looped noise layers) and `gust`.

### Determinism

Same seed, key, meter and settings give the same track. A preset has no seed so loading one gives a new track, unless it carries `internals.seed`. Nothing audible may use `Math.random`; only Regenerate picks a new seed.

## Controls

Ten axes, each 0 to 1, each with one audible meaning, each mapped to several internal values in the `mappings` table in `params.js`:

| Axis | Meaning |
|---|---|
| Emotion | Stepped picker over `EMOTIONS` (below) |
| Pace | Tempo and modulation speed |
| Energy | Dynamics, attack time, modulation depth |
| Density | Number of layers and notes |
| Structure | Free to locked: grid quantisation and repetition |
| Pulse | Beatless to driving: how much percussion plays |
| Space | Reverb size and mix, stereo width, orbit width |
| Texture | Noise bed against pitched voices (quiet until well past the middle, takes over at the top) |
| Color | Warm to airy: tilt and ceiling of the noise bed only |
| Brightness | Filter cutoffs and the master high shelf |

**Emotion** (dark to bright): Dark, Sad, Nostalgic, Tender, Peaceful, Dreamy, Hopeful, Happy. Each is a fixed recipe in `EMOTIONS`: mode, `longing`, chord lengths, tempo lean. `applyFeeling` in `composer.js` turns it into borrowed chords, cadence habits, suspensions, sevenths, added ninths, appoggiaturas and a Picardy lift. The seed only nudges these slightly, so an emotion sounds alike on every seed. Anything that changes how a track feels must be driven by Emotion, never drawn freely from the seed. The key never changes during a track. Old saved `mood` values migrate to the nearest emotion.

**Internals** (under Advanced): `key`, `evolutionRate`, `seed`, `meter` (0 = chosen by seed). Regenerate randomises internals only (new seed, key, evolution rate); sliders and meter stay; an active preset keeps the internals it sets.

**Presets** are `{ id, name, axes, internals }`, either part any subset. Built-ins are in `engine/presets.js`; saved ones go through `platform/presets.js` (`list/save/remove/subscribe`, localStorage now, replaceable by an account store). Changing any control by hand clears the active preset ("Custom").

**Saved state**: `mugen.settings.v1` (axes, internals, volume, sleep timer, active preset, mix option), restored through `restoreAxes` and `restoreInternals`, which drop unknown or out-of-range values; `mugen.presets.v1`.

## Composer

Bars are counted in sixteenth steps; rhythm is expressed on the meter's `starts` and `strong` positions (4/4, 3/4, 6/8, 12/8, rarely 5/4, 7/8, 9/8). It plans in forms (rondo, ternary, theme and variations, sonata-like, arch, chaconne, free wandering) built from episodes that carry a theme, variation level and harmony; when a form ends a new one is drawn. Harmony uses named schemata in `theory.js`; each section's last two bars are a cadence with a slight ritardando. Accidentals are per chord, never key changes. Every track opens with an 8-bar intro under a master fade-in (1 s silence, then 3 s). A `bloom` section is beatless and pad-led. Non-emotion style (swing, rubato, voicing, bass pattern, motif habits, register, stereo habits) comes from the seed in `drawStyle`.

## Mix and sound rules

Violating these has caused audible bugs before.

- **Loudness comes from static gain and per-role levels, not compression.** A compressor that lifts quiet material makes a lone noise bed louder than the same bed under music. The master is linear to about -16 dB (gain flat at +2.9 dB from -50 to -16 dB input), then a gentle glue compressor (threshold -12 dB, ratio 2), a limiter at -1.5 dB and a soft clipper, so output cannot exceed full scale.
- **Every compressor is followed by a makeup-cancelling gain.** Native `DynamicsCompressorNode` adds about 1.6x makeup of its own. After changing a compressor, re-measure the level curve with a sine at several levels.
- **Role levels** are `db` in `ROLES` (`instruments.js`), set from measured soloed levels in a dense preset. Level new or changed sounds by measurement against the others. Full mixes should land about -17 to -28 dBFS RMS with limiter-input peaks about -1 to -10 dBFS; much quieter than that pushes listeners to full device volume.
- **Channel compressors** only on loud sustained roles (`strip: true`); elsewhere they cost CPU for nothing.
- **Never set a live audio param instantly.** Use the slew helpers (`glide`, `toneRamp`, `rampTo`); instant changes click.
- **Top end stays quiet at every setting**: master low-pass about 7.5 kHz, high-shelf cut, warm spectral tilt on sounds, everything below 40 Hz cut.
- **Reverb** is three fixed impulse responses (1.5, 4, 7 s) crossfaded by gain. Never regenerate a convolver buffer at runtime; it clicks.
- **Stereo**: width 0.5 is neutral and 1 deletes the centre, so Space stays within 0.5 to 0.75. Panning is a plain stereo pan; the lead and bell sweep with an LFO (`orbit`). `Tone.Channel` defaults to mono, so always pass `channelCount: 2`.
- **Bells** (`bell`, `drip`) use octaves and fifths of the root only (`BELL_RATIOS` in `voices.js`, at most 0.6% stretch). Real-bell partials (minor third, inharmonic) sound dark and out of tune against the chord; do not add a third. Pitched percussion is retuned to the chord.
- **Voice caps** (140 overall, per-role limits in `instruments.js`) bound the graph. Voice bookkeeping is pruned by scheduled stop time, not `onended`, which can be missed after an interruption.
- **CPU**: the context runs at 24 kHz (`CONTEXT_RATE` in `engine.js`, `latencyHint: "playback"`), safe because everything is rolled off at 7.5 kHz. Dense preset, measured offline: about 3.4 s of CPU per minute of audio at 24 kHz (7.0 at 48 kHz). Each node costs about the same whether audible or not; measure before adding nodes.
- **Main thread stays free**: no render, long loop or heavy work in `tick`, event handlers or note triggers. Check with a real-time run in headless Chromium and a `longtask` PerformanceObserver; the engine should show none.
- **Safety**: the watchdog in `tick` stops the engine with a notice on NaN or infinity at the output; planner errors are contained and three in a row stop playback.

## Playback, pause and platform

Mobile background audio is the main technical risk: webviews can suspend audio and throttle timers when backgrounded or locked.

- The master output feeds a `MediaStreamDestination` into a hidden `<audio>` element (`platform/web.js`) with Media Session metadata and `navigator.audioSession.type = "playback"`. Keep the master routable to an `<audio>` element. The optional "play alongside other audio" mode uses an ambient audio session and no element (plays under other media, not with the screen locked).
- `output.open()` must run synchronously in the click handler, before any `await`.
- **Pause never suspends the audio context** (that looped stale buffers and killed notes). It fades the output with half-cosine curves (1 s in-app, about 0.35 s when the system forced it) and freezes the planner; the clock keeps running. On resume the planner catches up and drops events already past. A pause over two minutes, or a context that will not wake, restarts the track.
- In-app pause leaves the `<audio>` element playing silence (stopping and restarting it clicks). A pause from Control Center or the lock screen also pauses the element after the fade, because iOS derives its playing state from the element.
- Interruptions (calls, Siri, other apps) count as a pause: context `statechange`, the element's `pause` event, Media Session actions, and returning to a visible page with a non-running context. If the context will not run on the next Play, the page reloads (settings persist).
- Stop happens only via the sleep timer (fades over the last minute) and on errors.
- Fallback if background playback does not hold: render in chunks with `Tone.Offline` and play through an `<audio>` element or native player.

## Conventions

- Comments are rare, short, lowercase, one line, only for a constraint, gotcha or non-obvious why. No docblocks or banners.
- UI text is plain language for non-musicians. Parameter names are fine; theory terms, song forms, theme labels and instrument names are not shown. Section labels: Intro, Low, Mid, High, Break, Ambient (`ui/labels.js`).
- No CSS beyond what is necessary until the visual design is decided.

## How to change things

- **Add or change an axis**: add to `axes` and a `mappings` entry in `params.js` (the UI renders axes generically; one with `options` renders as a picker); use the resolved value in the composer or `instruments.apply`; set it in `engine/presets.js`; `restoreAxes` defaults old saved data.
- **Add an emotion**: add to `EMOTIONS`. Order is dark to bright and is the stored value, so reordering or inserting changes what saved presets mean; append or add a migration. Re-run a simulation across many seeds to check the recipe is distinct and the spread across seeds is small.
- **Add an instrument role**: gene spec in `SPECS` (`genome.js`), renderer in `voices.js`, maker and `ROLES` entry (level, sends, group) in `instruments.js`, a push entry in `drawStyle`, events in the composer. Level it by measurement.
- **Add a preset**: object in `DEFAULT_PRESETS`; use `emotionValue("id")` and `meter(name)`.
- **Add a platform capability**: put it in `platform/` behind a small interface and wire it in `main.js`.

## Verifying changes

You usually cannot listen, so verify by measurement and say plainly that the sound itself is unheard.

- **Load the page and press Play**; check the console. A passing build is not enough.
- **Pure modules run in Node** (`composer`, `theory`, `meter`, `genome`, `params`, `rng`, `dsp`, `voices`, `texture`): import them to simulate hundreds of bars over many seeds and count chord colours, cadences, note ranges and NaNs, or to render a buffer and inspect its spectrum and peaks. Node warns about no `"type": "module"`; ignore it.
- **Graph changes run offline in a browser** with `Tone.Offline`, which renders the real mixer and instruments faster than real time. Plan events with the composer, schedule them in time order while overriding the context's `currentTime` to `event.time - 5` (so voice caps behave as live), and drive headless Chromium over the DevTools protocol. Read RMS, peak, crest, CPU per minute of audio, and per-role levels (build the instruments with a role filter in your harness). Do not edit source files while a run is in progress; Vite hot reload kills it.
- **Measure curves, not impressions**: sweep a sine through the mixer at several levels for dynamics; take harmonic content of a sine for distortion.
- **Real devices**: background audio, interruptions, Control Center and speaker distortion can only be confirmed on a real iPhone and Android phone.

## Known gaps

- Not verified: lock-screen playback with the current engine, Android, and behaviour inside the Capacitor shell. An early iOS Safari test (older, simpler engine) held for about 15 minutes; raise `COMMIT_S` if gaps appear on a device.
- Possible clipping or harshness on the iPhone speaker (earbuds fine) is unresolved and deferred to the native iOS work. Levels are at normal loudness now, untested on the device.
- CPU and battery on real phones are unmeasured; the numbers above are from a desktop.
- No accounts; presets are local only.

## Open decisions

Ask the owner rather than assuming: the sound goal and feature set, whether user accounts exist (at most minimal preset storage), and the visual design.
