import { MODE_LABELS, SECTION_LABELS, SLEEP_OPTIONS } from "./labels.js";

export function mountApp(root, { store, axes, internals, noteNames, onPlay, onPause, onAxis, onInternal, onRegenerate, onVolume, onSleep, presets, mix, onMix }) {
  root.innerHTML = `
    <h1>mu.gen</h1>
    <div class="actions">
      <button id="toggle">Play</button>
      <button id="regenerate">Regenerate</button>
      <label class="inline">Sleep timer <select id="sleep"></select></label>
    </div>
    <label class="mix"><input id="mix" type="checkbox" /> Play alongside other audio (takes effect next start)</label>
    <label class="volume">Volume <input id="volume" type="range" min="0" max="100" /></label>
    <div class="presets">
      <label class="inline">Preset <select id="preset"></select></label>
      <button id="save-preset">Save preset</button>
      <button id="delete-preset">Delete</button>
    </div>
    <p id="notice"></p>
    <p id="readout"></p>
    <p id="where"></p>
    <div id="axes"></div>
    <details>
      <summary>Advanced</summary>
      <label>Key <select id="key"></select></label>
      <label>Time signature <select id="meter"></select></label>
      <label>Evolution rate <input id="evolutionRate" type="range" min="0" max="100" /></label>
      <label>Seed <input id="seed" type="number" min="0" step="1" /></label>
    </details>
  `;

  const toggle = root.querySelector("#toggle");
  const readout = root.querySelector("#readout");
  const notice = root.querySelector("#notice");
  const where = root.querySelector("#where");
  const axesRoot = root.querySelector("#axes");
  const key = root.querySelector("#key");
  const meterSelect = root.querySelector("#meter");
  const evolutionRate = root.querySelector("#evolutionRate");
  const seed = root.querySelector("#seed");
  const volume = root.querySelector("#volume");
  const sleep = root.querySelector("#sleep");
  const mixBox = root.querySelector("#mix");
  mixBox.checked = mix;
  mixBox.addEventListener("change", () => onMix(mixBox.checked));
  const presetSelect = root.querySelector("#preset");
  const deletePreset = root.querySelector("#delete-preset");

  const sliders = {};
  for (const [name, { label, low, high, steps, options }] of Object.entries(axes)) {
    if (options) {
      const row = document.createElement("label");
      row.className = "axis";
      row.innerHTML = `<span class="axis-name">${label}</span>`;
      const select = document.createElement("select");
      options.forEach((text, index) => select.add(new Option(text, index)));
      select.addEventListener("change", () => onAxis(name, Number(select.value) / (options.length - 1)));
      row.appendChild(select);
      axesRoot.appendChild(row);
      sliders[name] = select;
      continue;
    }
    const row = document.createElement("label");
    row.className = "axis";
    row.innerHTML = `<span class="axis-name">${label}</span><span class="axis-ends">${low} · ${high}</span>`;
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    if (steps) input.step = String(100 / (steps - 1));
    input.addEventListener("input", () => onAxis(name, input.value / 100));
    row.appendChild(input);
    axesRoot.appendChild(row);
    sliders[name] = input;
  }

  noteNames.forEach((note, index) => key.add(new Option(note, index)));
  internals.meter.choices.forEach((name, index) => meterSelect.add(new Option(name === "auto" ? "Auto" : name, index)));
  SLEEP_OPTIONS.forEach(([minutes, label]) => sleep.add(new Option(label, minutes)));

  const fillPresets = () => {
    presetSelect.replaceChildren(new Option("Custom", ""), ...presets.list().map((p) => new Option(p.name, p.id)));
    presetSelect.value = store.get().activePreset?.id ?? "";
    deletePreset.disabled = !store.get().activePreset || store.get().activePreset.builtin;
  };
  presets.subscribe(fillPresets);
  fillPresets();
  presetSelect.addEventListener("change", () => presets.apply(presetSelect.value));
  root.querySelector("#save-preset").addEventListener("click", () => {
    const name = window.prompt("Preset name")?.trim();
    if (name) presets.save(name);
  });
  deletePreset.addEventListener("click", () => {
    const { activePreset } = store.get();
    if (activePreset && !activePreset.builtin && window.confirm(`Delete "${activePreset.name}"?`)) presets.remove(activePreset.id);
  });

  toggle.addEventListener("click", () => {
    const { running, paused } = store.get();
    return running && !paused ? onPause() : onPlay();
  });
  root.querySelector("#regenerate").addEventListener("click", onRegenerate);
  key.addEventListener("change", () => onInternal("key", Number(key.value)));
  meterSelect.addEventListener("change", () => onInternal("meter", Number(meterSelect.value)));
  evolutionRate.addEventListener("input", () => onInternal("evolutionRate", internals.evolutionRate.range[0] + (evolutionRate.value / 100) * (internals.evolutionRate.range[1] - internals.evolutionRate.range[0])));
  seed.addEventListener("change", () => onInternal("seed", Math.max(0, Math.floor(Number(seed.value) || 0))));
  volume.addEventListener("input", () => onVolume(volume.value / 100));
  sleep.addEventListener("change", () => onSleep(Number(sleep.value)));

  store.subscribe((state) => {
    toggle.textContent = state.running && !state.paused ? "Pause" : "Play";
    notice.textContent = state.notice ?? "";
    if (presetSelect.value !== (state.activePreset?.id ?? "")) fillPresets();
    deletePreset.disabled = !state.activePreset || state.activePreset.builtin;
    for (const [name, input] of Object.entries(sliders)) {
      const { options } = axes[name];
      input.value = options ? Math.round(state.axes[name] * (options.length - 1)) : state.axes[name] * 100;
    }

    key.value = state.internals.key;
    meterSelect.value = state.internals.meter;
    volume.value = state.volume * 100;
    sleep.value = state.sleepMinutes;
    const [lo, hi] = internals.evolutionRate.range;
    evolutionRate.value = ((state.internals.evolutionRate - lo) / (hi - lo)) * 100;
    if (document.activeElement !== seed) seed.value = state.internals.seed;

    const { tonic, mode, section, meter } = state.status;
    const tempo = `${Math.round(state.resolved.tempoBpm)} bpm`;
    const playing = state.running && mode;
    const scale = playing ? `${noteNames[tonic]} ${MODE_LABELS[mode] ?? mode}` : `${noteNames[state.internals.key]} ${MODE_LABELS[state.resolved.mode]}`;
    const sleepNote = state.running && state.sleepMinutes ? `stops in ${state.sleepLeft} min` : null;
    const pausedNote = state.paused ? "paused" : null;
    readout.textContent = [scale, playing ? meter : null, tempo, pausedNote, sleepNote].filter(Boolean).join(" · ");
    where.textContent = playing ? SECTION_LABELS[section] ?? section : "";
  });
}
