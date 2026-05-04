export function constructTransport() {
  const container = document.createElement("div");

  // define elements
  const transportBtnsContainer = document.createElement("div");
  const playBtn = document.createElement("button");
  const resetBtn = document.createElement("button");

  const volumeContainer = document.createElement("div");
  const volumeBtn = document.createElement("button");
  const volumeSlider = document.createElement("div");
  const volumeSliderBar = document.createElement("div");
  const volumeSliderBarControl = document.createElement("div");
  const volumeSliderBarEmpty = document.createElement("div");


  // assign elements
  container.id = "transport";
  container.className = "section";

  transportBtnsContainer.className = "transport-btns-container";
  playBtn.className = "play-btn";
  playBtn.textContent = "▶";
  playBtn.classList.add("transport-btn");
  resetBtn.className = "reset-btn";
  resetBtn.textContent = "🗘";
  resetBtn.classList.add("transport-btn");

  volumeContainer.className = "volume-container";
  volumeBtn.className = "volume-btn";
  volumeBtn.textContent = "🕪";
  volumeSlider.className = "volume-slider";
  volumeSliderBar.className = "volume-slider-bar";
  volumeSliderBarControl.className = "volume-slider-bar-control";
  volumeSliderBarEmpty.className = "volume-slider-bar-empty";


  // add elements to main container

  transportBtnsContainer.appendChild(playBtn);
  transportBtnsContainer.appendChild(resetBtn);
  container.appendChild(transportBtnsContainer);

  volumeSlider.appendChild(volumeSliderBar);
  volumeSlider.appendChild(volumeSliderBarControl);
  volumeSlider.appendChild(volumeSliderBarEmpty);
  volumeContainer.appendChild(volumeBtn);
  volumeContainer.appendChild(volumeSlider);
  container.appendChild(volumeContainer);

  // return elements
  return container;
}
