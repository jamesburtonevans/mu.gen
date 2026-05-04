import { on, state, transportStart, transportPause } from "../engine/state.js";


// Transport toggle button
on("transportState", (value) => {
    const btn = document.querySelector(".play-btn");
    if (value === "playing") {
        btn.textContent = "❙❙";
    } else {
        btn.textContent = "▶";
    }
})

document.querySelector(".play-btn").addEventListener("click", async () => {
    if (state.transportState === "playing") {
        transportPause();
    } else {
        transportStart();
    }
});

/*
// Start detecting mouse movement
document.querySelector(".volume-slider-bar-control").addEventListener("mousedown", async () => {
  document.addEventListener("mousemove", changeVolumeSlider);
  //document.removeEventListener("mousemove", changeVolumeSlider);
});

function changeVolumeSlider(event) {
  const slider = document.querySelector(".volume-slider-bar");
  slider.style.width += `${event.movementX}px`;
}

*/
