export function createWebOutput(context) {
  let destination = null;
  let element = null;

  return {
    // must run synchronously inside a user gesture
    open() {
      if ("audioSession" in navigator) navigator.audioSession.type = "playback";
      destination = context.createMediaStreamDestination();
      element = new Audio();
      element.srcObject = destination.stream;
      return element.play();
    },

    get node() {
      return destination;
    },

    setMetadata({ title, artist }) {
      if (!("mediaSession" in navigator)) return;
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist });
      navigator.mediaSession.playbackState = "playing";
    },

    close() {
      if (element) {
        element.pause();
        element.srcObject = null;
        element = null;
      }
      destination = null;
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
    },
  };
}
