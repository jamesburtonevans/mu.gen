//////// AUDIO SIGNAL ////////

// GENERATORS //
const synthChannel = new Tone.Channel(-12, 0);
const synth = new Tone.Synth().connect(synthChannel);
const bassChannel = new Tone.Channel(0, 0);
const bass = new Tone.Synth().connect(bassChannel);

// EFFECTS //
const dist = new Tone.Distortion({ wet: 1, distortion: 1 });
const cheby = new Tone.Chebyshev({ wet: 1, order: 50 });
const cheby2 = new Tone.Chebyshev({ wet: 1, order: 15 });
const delay = new Tone.FeedbackDelay({ wet: 0.2, delayTime: "8n", feedback: 0.7 });
const reverb = new Tone.Reverb({ wet: 0.7, decay: 5 });

// CHANNELS //
const instrumentsBusChannel = new Tone.Channel(-6, 0);

// ROUTING //
synthChannel.chain(dist, cheby, instrumentsBusChannel);
synthChannel.pan.value = 1;
bassChannel.chain(cheby2, instrumentsBusChannel);
instrumentsBusChannel.chain(delay, reverb, Tone.Destination);

//////// NOTES AND SONG STRUCTURE  ////////

// SONG STATE //
Tone.Transport.bpm.value = 120;
Tone.Transport.timeSignature = 4;

// SEQUENCE //

const scale = ["C2", "D2", "E2", "F2", "G2", "A2", "B2"];
const autoMelody = [];

let melody = [["E3", "D3", "C3", "D3"], "G3", "A3", "E3", "C3", ["C2", "C1"], "E2", ["B2", "G2"]];
let bassline = [["C2", "C2", "A1", ["A1", ["A1", "G1", "A1", "B1"]]]];

const sequence01 = new Tone.Sequence(function (time, note) {
    synth.triggerAttackRelease(note, 0.1);
}, melody, '4n');

const sequence02 = new Tone.Sequence(function (time, note) {
    bass.triggerAttackRelease(note, 1);
}, bassline, '4m');

// TRIGGER //
const playBTN = document.getElementById("play-btn");

playBTN.addEventListener("click", () => {
    if (Tone.getContext().state != "running") {
        Tone.start();
        sequence01.start();
        sequence02.start();
        Tone.Transport.start();
        console.log('Sequence playing');
    }
})
