export function constructTransport() {
  const container = document.createElement("div");

  // define elements
  const transportBtnsContainer = document.createElement("div");
  const playBtn = document.createElement("button");
  const playIcon = document.createElement("i");
  const resetBtn = document.createElement("button");
  const resetIcon = document.createElement("i");

  const volumeContainer = document.createElement("div");
  const volumeBtn = document.createElement("button");
  const volumeIcon = document.createElement("i");
  const volumeSlider = document.createElement("div");
  const volumeSliderBar = document.createElement("div");
  const volumeSliderBarControl = document.createElement("div");
  const volumeSliderBarEmpty = document.createElement("div");


  // assign elements
  container.id = "transport";
  container.className = "section";

  transportBtnsContainer.className = "transport-btns-container";
  playBtn.className = "play-btn";
  playIcon.className = "fa fa-play";
  playBtn.classList.add("transport-btn");
  resetBtn.className = "reset-btn";
  resetIcon.className = "fa fa-refresh";
  resetBtn.classList.add("transport-btn");

  volumeContainer.className = "volume-container";
  volumeBtn.className = "volume-btn";
  volumeIcon.className = "fa fa-volume-up";
  volumeSlider.className = "volume-slider";
  volumeSliderBar.className = "volume-slider-bar";
  volumeSliderBarControl.className = "volume-slider-bar-control";
  volumeSliderBarEmpty.className = "volume-slider-bar-empty";


  // add elements to main container

  playBtn.appendChild(playIcon);
  transportBtnsContainer.appendChild(playBtn);
  resetBtn.appendChild(resetIcon);
  transportBtnsContainer.appendChild(resetBtn);
  container.appendChild(transportBtnsContainer);

  volumeSlider.appendChild(volumeSliderBar);
  volumeSlider.appendChild(volumeSliderBarControl);
  volumeSlider.appendChild(volumeSliderBarEmpty);
  volumeBtn.appendChild(volumeIcon);
  volumeContainer.appendChild(volumeBtn);
  volumeContainer.appendChild(volumeSlider);
  container.appendChild(volumeContainer);

  // return elements
  return container;
}
