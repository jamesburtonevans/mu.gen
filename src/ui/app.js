export function mountApp(root, { store, onStart, onStop, onParam }) {
  root.innerHTML = `
    <h1>mu.gen</h1>
    <button id="toggle">Start</button>
    <label>Brightness <input id="brightness" type="range" min="0" max="100" /></label>
    <label>Density <input id="density" type="range" min="0" max="100" /></label>
  `;

  const toggle = root.querySelector("#toggle");
  const brightness = root.querySelector("#brightness");
  const density = root.querySelector("#density");

  toggle.addEventListener("click", () => (store.get().running ? onStop() : onStart()));
  brightness.addEventListener("input", () => onParam("brightness", brightness.value / 100));
  density.addEventListener("input", () => onParam("density", density.value / 100));

  store.subscribe((state) => {
    toggle.textContent = state.running ? "Stop" : "Start";
    brightness.value = state.brightness * 100;
    density.value = state.density * 100;
  });
}
