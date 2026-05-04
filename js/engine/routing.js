//import { masterVolumeSet } from "./state.js";
import { testSynth } from "./instruments/pluck.js";
import { bassSynth } from "./instruments/bass.js";

//// CHANNELS ////

// instruments //
const pluckChannel = new Tone.Channel(-12, 0);
const bassChannel = new Tone.Channel(-12, 0);

// busses //
const master = new Tone.Channel(0, 0);


//// ROUTING ////

// instruments //
testSynth.connect(pluckChannel);
bassSynth.connect(bassChannel);

// busses //
pluckChannel.connect(master);
bassChannel.connect(master);
//master.volume.value = masterVolumeSet();
master.toDestination();
