export function constructControls() {
  const container = document.createElement("div");

  // define elements
  const presets = document.createElement("div");

  const mainContainer = document.createElement("div");

  const controlContainer = document.createElement("div");

  const heading = document.createElement("h1");

  const tempo = slider("Tempo", 60, 180, 120);
  const density = slider("Density", 0, 100, 60);
  const brightness = slider("Brightness", 0, 100, 40);
  const space = slider("Space", 0, 100, 70);

  const playerContainer = document.createElement("div");
  const player = document.createElement("div");
  const playerTime = document.createElement("p");
  const playerVisual = document.createElement("img");

  // assign elements
  container.id = "controls";
  container.className = "section";
  mainContainer.id = "ctr-main-container";
  controlContainer.className = "control-container";
  presets.className = "presets";
  heading.className = "ctr-heading";
  heading.textContent = "Controls";

  playerContainer.id = "player-container";
  player.id = "player";
  playerTime.id = "player-time";
  playerTime.textContent = "01:23";
  playerVisual.id = "player-visual";
  playerVisual.src = "../assets/images/waveform.svg";

  // add elements to main container
  presets.appendChild(preset("Focus"));
  presets.appendChild(preset("Relax"));
  presets.appendChild(preset("Sleep"));
  presets.appendChild(preset("Active"));
  presets.appendChild(preset("Meditation"));

  container.appendChild(presets);

  controlContainer.appendChild(heading);

  controlContainer.appendChild(tempo);
  controlContainer.appendChild(density);
  controlContainer.appendChild(brightness);
  controlContainer.appendChild(space);

  playerContainer.appendChild(player);
  player.appendChild(playerTime);
  player.appendChild(playerVisual);

  mainContainer.appendChild(controlContainer);
  mainContainer.appendChild(playerContainer);

  container.appendChild(mainContainer);


  //container.appendChild(volumeContainer);

  // return elements
  return container;
}

function slider(name, min, max, defaultValue) {
  const container = document.createElement("div");
  const label = document.createElement("div");
  const slider = document.createElement("input");
  const value = document.createElement("div");

  container.id = `ctr-${name}`;
  container.className = 'ctr-control';

  label.className = 'ctr-label';
  label.id = `label-${toID(name)}`;
  label.textContent = `${name}`;

  slider.className = 'ctr-slider';
  slider.id = `slider-${toID(name)}`;
  slider.type = "range";
  slider.min = `${min}`;
  slider.max = `${max}`;
  slider.value = `${defaultValue}`;

  value.className = 'ctr-value';
  value.id = `value-${toID(name)}`;
  value.textContent = `${slider.value}`
  slider.oninput = function() {
    value.textContent = `${this.value}`;
  }

  /////

  container.appendChild(label);
  container.appendChild(slider);
  container.appendChild(value);

  return container;
}

function preset(name) {
  const container = document.createElement("div");
  const label = document.createElement("p");

  container.id = `preset-${toID(name)}`;
  container.className = 'preset';
  label.className = "preset-label";
  label.textContent = `${name}`;

  container.appendChild(label);
  return container;
}

function toID(input) {
  input = input.toLowerCase();
  input = input.replace(/\s/g, "-");
  return input;
}
