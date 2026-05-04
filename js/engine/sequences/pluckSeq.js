import { on, state, setState } from "../state.js";
import { testSynth } from "../instruments/pluck.js";
import "../arrangement.js";

const pluckSequence = new Tone.Sequence((time, note) => {
    testSynth.triggerAttackRelease(note, 0.1, time);
}, ["C4", "D4", ["C4", "D4"], "E4"], "4n");



on("currentSection", (section) => {
    pluckSequence.stop(Tone.now());
    if (section === "intro") {
        pluckSequence.start(Tone.now());
    }
    if (section === "high") {
        pluckSequence.start(Tone.now());
    }
})