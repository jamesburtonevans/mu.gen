import { on, state, setState } from "./state.js";

let barCount = 0;
let currentSection = "intro";
let nextSection;
let currentSectionLength;

const sections = ["low", "med", "high"];

const sectionRules = {
    med: [{ next: "high", weight: 0.5 }, { next: "low", weight: 0.5 }],
    high: [{ next: "med", weight: 0.8 }, { next: "low", weight: 0.2 }],
    low: [{ next: "med", weight: 0.8 }, { next: "high", weight: 0.2 }]
}

const sectionLengthOptions = [4, 6, 8];

function transitionReset() {
    currentSectionLength = sectionLengthOptions[Math.floor(Math.random() * sectionLengthOptions.length)];
    barCount = 0;
}

transitionReset();
setState("currentSection", "intro");

Tone.Transport.scheduleRepeat((time) => {
    barCount++;
    console.log(`bar: ${barCount}, section: ${currentSection}, currentSectionlength: ${currentSectionLength}`);
    transitionHandler();
}, "1m");

function transitionHandler() {
    if (currentSection === "intro") {
        if (barCount === currentSectionLength) {
            currentSection = "med";
            setState("currentSection", currentSection);
            transitionReset();
        }
    } else {
        if (barCount === currentSectionLength) {
            const rand = Math.random();
            const options = sectionRules[currentSection];
            let accumulated = 0;
            for (let i = 0; i < options.length; i++) {
                accumulated += options[i].weight;
                if (accumulated > rand) {
                    currentSection = options[i].next;
                    setState("currentSection", currentSection);
                    break;
                }
            }
            transitionReset();
        }

    }

}