import { on, state, setState } from "../state.js";
import { bassSynth } from "../instruments/bass.js";
import "../arrangement.js";

const bassSequence = new Tone.Sequence((time, note) => {
    bassSynth.triggerAttackRelease(note, 0.1, time);
}, ["C3", "D2", ["C3", "D2"], "E2"], "2n");

on("currentSection", (section) => {
    if (section === "med") {
        bassSequence.start(Tone.now());
    }
})