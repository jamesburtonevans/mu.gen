export function createWebOutput(context, { onInterrupt, onPause, onPlay } = {}) {
  let destination = null;
  let element = null;
  let mixing = false;

  return {
    // must run synchronously inside a user gesture
    // mix: play alongside other apps' audio. that needs an ambient session and no media element (an element asks
    // the system for exclusive audio), which also means no lock-screen controls and no playback once the screen locks
    open({ mix = false } = {}) {
      mixing = mix;
      if ("audioSession" in navigator) navigator.audioSession.type = mix ? "ambient" : "playback";
      if (mix) return Promise.resolve();
      destination = context.createMediaStreamDestination();
      const own = new Audio();
      element = own;
      own.srcObject = destination.stream;
      // the system pauses the element when something else takes the audio (a call, another app)
      own.addEventListener("pause", () => {
        if (element === own) onInterrupt?.();
      });
      return own.play();
    },

    get node() {
      return mixing ? context.destination : destination;
    },

    setMetadata({ title, artist }) {
      if (mixing || !("mediaSession" in navigator)) return;
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist });
      navigator.mediaSession.playbackState = "playing";
      navigator.mediaSession.setActionHandler("pause", () => onPause?.());
      navigator.mediaSession.setActionHandler("play", () => onPlay?.());
    },

    // the system may have paused the element during an interruption, so resuming has to start it again
    play: () => element?.play() ?? Promise.resolve(),

    setPlaybackState(state) {
      if ("mediaSession" in navigator && !mixing) navigator.mediaSession.playbackState = state;
    },

    // silence the element before the context freezes, so it has no stale buffer to repeat
    hold() {
      element?.pause();
    },

    close() {
      const own = element;
      element = null;
      own?.pause();
      if (own) own.srcObject = null;
      destination = null;
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
    },
  };
}
