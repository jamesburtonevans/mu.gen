import * as Tone from "tone";

export function createMixer() {
  const master = new Tone.Gain(1);

  const reverb = new Tone.Reverb({ decay: 9, wet: 1 });
  const reverbBus = new Tone.Gain(1);
  reverbBus.connect(reverb);
  reverb.connect(master);

  function addChannel({ volume = 0, pan = 0, reverbSend = 0 } = {}) {
    const input = new Tone.Channel({ volume, pan });
    input.connect(master);

    const send = new Tone.Gain(reverbSend);
    input.connect(send);
    send.connect(reverbBus);

    return { input, reverbSend: send };
  }

  return { master, addChannel, ready: reverb.ready };
}
