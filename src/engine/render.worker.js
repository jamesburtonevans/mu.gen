import { RENDERERS } from "./renderers.js";

self.onmessage = ({ data: { id, name, args } }) => {
  try {
    const result = RENDERERS[name](...args);
    self.postMessage({ id, result }, result.channels.map((channel) => channel.buffer));
  } catch (error) {
    self.postMessage({ id, error: String(error?.stack ?? error) });
  }
};
