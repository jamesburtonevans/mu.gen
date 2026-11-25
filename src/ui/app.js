import { icons } from "./icons.js";
import { PRESET_NAME_MAX, MODE_LABELS, SECTION_LABELS, SLEEP_OPTIONS } from "./labels.js";

export function mountApp(root, { store, axes, internals, noteNames, onPlay, onPause, onAxis, onInternal, onRegenerate, onVolume, onSleep, presets, mix, onMix }) {
  root.innerHTML = `
    <h1>mu.gen</h1>
    <div class="hero-wrap">
      <button class="hero" id="hero" type="button" aria-haspopup="dialog" aria-expanded="false">
        <span class="hero-art" id="hero-art"></span>
        <span class="hero-name"><span id="hero-name"></span>${icons.chevron}</span>
        <span class="hero-detail" id="hero-detail"></span>
      </button>
      <div class="menu" id="menu" role="dialog" aria-label="Presets" hidden></div>
    </div>
    <p id="notice" class="notice"></p>
  `;
  document.body.insertAdjacentHTML("beforeend", `
    <footer class="footer" id="footer"><div class="footer-inner">
      <div class="transport">
        <div class="transport-side">
          <button class="btn" id="tune-open" type="button" aria-pressed="false" aria-expanded="false" aria-controls="sheet" aria-label="Edit" title="Edit">${icons.edit}</button>
          <label class="btn" id="sleep-button" title="Sleep timer">${icons.moon}<select id="sleep" aria-label="Sleep timer"></select></label>
          <button class="btn" id="mix" type="button" aria-pressed="false" aria-label="Play alongside other audio (takes effect next start)" title="Play alongside other audio (takes effect next start)">${icons.layers}</button>
        </div>
        <button class="btn btn--large" id="toggle" type="button" aria-label="Play">${icons.play}</button>
        <div class="transport-side">
          <button class="btn" id="regenerate" type="button" aria-label="Regenerate" title="Regenerate">${icons.refresh}</button>
          <label class="volume" title="Volume">${icons.volume}<input id="volume" type="range" min="0" max="100" aria-label="Volume" /></label>
        </div>
      </div>
    </div></footer>
    <div class="scrim" id="scrim"></div>
    <div class="sheet" id="sheet" role="dialog" aria-label="Edit" inert>
      <div class="sheet-header">
        <span class="sheet-title">${icons.edit}<span>Edit</span></span>
        <button class="icon-btn" id="tune-close" type="button" aria-label="Close">${icons.close}</button>
      </div>
      <div class="sheet-body">
        <div id="axes" class="axes"></div>
        <details>
          <summary>Advanced</summary>
          <div class="advanced-fields">
            <label class="field">Key <span class="select"><select id="key"></select></span></label>
            <label class="field">Time signature <span class="select"><select id="meter"></select></span></label>
            <label class="axis">Evolution rate <input id="evolutionRate" type="range" min="0" max="100" /></label>
            <label class="field">Seed <input id="seed" type="number" min="0" step="1" /></label>
          </div>
        </details>
      </div>
    </div>
  `);

  const $ = (selector) => document.querySelector(selector);
  const toggle = $("#toggle");
  const notice = $("#notice");
  const axesRoot = $("#axes");
  const key = $("#key");
  const meterSelect = $("#meter");
  const evolutionRate = $("#evolutionRate");
  const seed = $("#seed");
  const volume = $("#volume");
  const sleep = $("#sleep");
  const sleepButton = $("#sleep-button");
  const mixBox = $("#mix");
  const hero = $("#hero");
  const heroArt = $("#hero-art");
  const heroName = $("#hero-name");
  const heroDetail = $("#hero-detail");
  const menu = $("#menu");
  const sheet = $("#sheet");
  const scrim = $("#scrim");
  const tuneOpen = $("#tune-open");
  const tuneClose = $("#tune-close");
  const footer = $("#footer");
  new ResizeObserver(() => document.documentElement.style.setProperty("--footer-height", `${footer.offsetHeight}px`)).observe(footer);

  const setMix = (on) => mixBox.setAttribute("aria-pressed", String(on));
  setMix(mix);
  mixBox.addEventListener("click", () => {
    const on = mixBox.getAttribute("aria-pressed") !== "true";
    setMix(on);
    onMix(on);
  });
  const fill = (input) => input.style.setProperty("--value", `${((input.value - input.min) / (input.max - input.min)) * 100}%`);
  let lastPreset = null;
  let shownPreset = null;
  const glide = (input, target, animate) => {
    cancelAnimationFrame(input.frame);
    const from = Number(input.value);
    const start = performance.now();
    const step = (now) => {
      const t = animate ? Math.min(1, (now - start) / 500) : 1;
      input.value = from + (target - from) * (1 - (1 - t) ** 3);
      fill(input);
      if (t < 1) input.frame = requestAnimationFrame(step);
    };
    step(start);
  };

  const sliders = {};
  for (const [name, { label, low, high, steps, options }] of Object.entries(axes)) {
    if (options) {
      const row = document.createElement("label");
      row.className = "field";
      row.innerHTML = `<span class="axis-name">${label}</span><span class="select"><select></select></span>`;
      const select = row.querySelector("select");
      options.forEach((text, index) => select.add(new Option(text, index)));
      select.addEventListener("change", () => onAxis(name, Number(select.value) / (options.length - 1)));
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
    input.addEventListener("input", () => {
      fill(input);
      onAxis(name, input.value / 100);
    });
    row.appendChild(input);
    axesRoot.appendChild(row);
    sliders[name] = input;
  }

  noteNames.forEach((note, index) => key.add(new Option(note, index)));
  internals.meter.choices.forEach((name, index) => meterSelect.add(new Option(name === "auto" ? "Auto" : name, index)));
  SLEEP_OPTIONS.forEach(([minutes, label]) => sleep.add(new Option(label, minutes)));

  // preset menu
  const syncScrim = () => scrim.classList.toggle("is-open", !menu.hidden || sheet.classList.contains("is-open"));
  const closeMenu = (refocus = true) => {
    if (menu.hidden) return;
    menu.hidden = true;
    syncScrim();
    hero.setAttribute("aria-expanded", "false");
    if (refocus) hero.focus();
  };
  const openMenu = () => {
    menu.hidden = false;
    syncScrim();
    hero.setAttribute("aria-expanded", "true");
    (menu.querySelector("[aria-current=true]") ?? menu.querySelector("button"))?.focus();
  };
  hero.addEventListener("click", () => (menu.hidden ? openMenu() : closeMenu()));

  const askSave = () => {
    const name = window.prompt(`Preset name (up to ${PRESET_NAME_MAX} characters)`)?.trim().slice(0, PRESET_NAME_MAX).trim();
    if (name) presets.save(name);
  };
  const item = (icon, name) => {
    const el = document.createElement("div");
    el.className = "menu-item";
    el.innerHTML = `<button class="menu-item-main" type="button">${icon}<span></span></button>`;
    el.querySelector("span").textContent = name;
    return el;
  };
  const fillMenu = () => {
    const items = presets.list().map((preset) => {
      const el = item(icons[preset.icon] ?? icons.sparkles, preset.name);
      el.dataset.id = preset.id;
      el.firstChild.addEventListener("click", () => {
        presets.apply(preset.id);
        closeMenu();
      });
      if (!preset.builtin) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "menu-item-remove";
        remove.setAttribute("aria-label", `Delete ${preset.name}`);
        remove.innerHTML = icons.close;
        remove.addEventListener("click", () => {
          if (!window.confirm(`Delete "${preset.name}"?`)) return;
          if (lastPreset?.id === preset.id) lastPreset = null;
          presets.remove(preset.id);
        });
        el.appendChild(remove);
      }
      return el;
    });
    const add = item(icons.plus, "New");
    add.title = "Save current settings as a preset";
    add.firstChild.addEventListener("click", () => {
      closeMenu(false);
      askSave();
    });
    const title = document.createElement("span");
    title.className = "menu-title";
    title.textContent = "Presets";
    const grid = document.createElement("div");
    grid.className = "menu-grid";
    grid.append(...items, add);
    menu.replaceChildren(title, grid);
    markActive();
  };
  const markActive = () => {
    const id = store.get().activePreset?.id;
    for (const el of menu.querySelectorAll("[data-id]")) el.firstChild.setAttribute("aria-current", String(el.dataset.id === id));
  };
  presets.subscribe(fillMenu);
  fillMenu();

  // tune sheet
  const setSheet = (open) => {
    if (open) closeMenu(false);
    sheet.classList.toggle("is-open", open);
    syncScrim();
    sheet.inert = !open;
    tuneOpen.setAttribute("aria-expanded", String(open));
    tuneOpen.setAttribute("aria-pressed", String(open));
    if (document.body.classList.contains("keyboard")) (open ? tuneClose : tuneOpen).focus({ preventScroll: true });
  };
  tuneOpen.addEventListener("click", () => setSheet(!sheet.classList.contains("is-open")));
  tuneClose.addEventListener("click", () => setSheet(false));
  scrim.addEventListener("click", () => (menu.hidden ? setSheet(false) : closeMenu()));
  document.addEventListener("pointerdown", () => document.body.classList.remove("keyboard"), true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") document.body.classList.add("keyboard");
    if (e.key !== "Escape") return;
    if (!menu.hidden) closeMenu();
    else if (sheet.classList.contains("is-open")) setSheet(false);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !hero.contains(e.target)) closeMenu(false);
  });

  toggle.addEventListener("click", () => {
    const { running, paused } = store.get();
    return running && !paused ? onPause() : onPlay();
  });
  $("#regenerate").addEventListener("click", onRegenerate);
  key.addEventListener("change", () => onInternal("key", Number(key.value)));
  meterSelect.addEventListener("change", () => onInternal("meter", Number(meterSelect.value)));
  evolutionRate.addEventListener("input", () => {
    fill(evolutionRate);
    onInternal("evolutionRate", internals.evolutionRate.range[0] + (evolutionRate.value / 100) * (internals.evolutionRate.range[1] - internals.evolutionRate.range[0]));
  });
  seed.addEventListener("change", () => onInternal("seed", Math.max(0, Math.floor(Number(seed.value) || 0))));
  volume.addEventListener("input", () => {
    fill(volume);
    onVolume(volume.value / 100);
  });
  sleep.addEventListener("change", () => onSleep(Number(sleep.value)));

  const emotions = axes.emotion.options;
  store.subscribe((state) => {
    const playing = state.running && !state.paused;
    toggle.innerHTML = playing ? icons.pause : icons.play;
    toggle.setAttribute("aria-label", playing ? "Pause" : "Play");
    notice.textContent = state.notice ?? "";

    if (state.activePreset) lastPreset = state.activePreset;
    markActive();
    const shown = state.activePreset ?? lastPreset;
    const edited = !state.activePreset && lastPreset;
    heroArt.innerHTML = icons[shown?.icon] ?? icons.sparkles;
    heroName.textContent = shown?.name ?? "Custom";
    hero.dataset.emotion = emotions[Math.round(state.axes.emotion * (emotions.length - 1))].toLowerCase();

    const picked = state.activePreset?.id !== shownPreset && state.activePreset;
    shownPreset = state.activePreset?.id;
    for (const [name, input] of Object.entries(sliders)) {
      const { options } = axes[name];
      if (options) input.value = Math.round(state.axes[name] * (options.length - 1));
      else glide(input, state.axes[name] * 100, picked);
    }

    key.value = state.internals.key;
    meterSelect.value = state.internals.meter;
    volume.value = state.volume * 100;
    sleep.value = state.sleepMinutes;
    sleepButton.classList.toggle("is-on", state.sleepMinutes > 0);
    const [lo, hi] = internals.evolutionRate.range;
    evolutionRate.value = ((state.internals.evolutionRate - lo) / (hi - lo)) * 100;
    fill(evolutionRate);
    fill(volume);
    if (document.activeElement !== seed) seed.value = state.internals.seed;

    const { tonic, mode, section, meter } = state.status;
    const live = state.running && mode;
    const scale = live ? `${noteNames[tonic]} ${MODE_LABELS[mode] ?? mode}` : `${noteNames[state.internals.key]} ${MODE_LABELS[state.resolved.mode]}`;
    heroDetail.textContent = [
      edited ? "Edited" : null,
      scale,
      live ? meter : null,
      `${Math.round(state.resolved.tempoBpm)} bpm`,
      live ? SECTION_LABELS[section] ?? section : null,
      state.paused ? "paused" : null,
      state.running && state.sleepMinutes ? `stops in ${state.sleepLeft} min` : null,
    ].filter(Boolean).join(" · ");
  });
}
