const listeners = {};

function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
    if (state[event] !== undefined) callback(state[event]);
}

function emit(event, value) {
    if (listeners[event]) listeners[event].forEach(cb => cb(value));
}

function setState(key, value) {
    state[key] = value;
    emit(key, value);
}

export const state = {
  transportState: "stopped",
  masterVolume: "100%",
  tempo: 120,
  mood: "calm",
  key: "C",
  currentSection: "intro"
};

export { on, setState };


export function transportStart() {
    Tone.Transport.start();
    setState("transportState", "playing");
}

export function transportPause() {
    Tone.Transport.pause();
    setState("transportState", "paused");
}

export function transportStop() {
    Tone.Transport.stop();
    setState("transportState", "stopped");
}

/*
export function masterVolumeSet() {
  setState("masterVolume");
}
*/
