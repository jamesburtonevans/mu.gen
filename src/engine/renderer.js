import { RENDERERS } from "./renderers.js";

// rendering a sound takes tens to hundreds of milliseconds, far longer on a phone. on the main thread that stalls
// timers and the media stream that feeds the output element, which is audible as choppy playback. so renders run in a
// worker, one at a time, and the main thread only ever copies finished samples into buffers.

export const inlineRenderer = { sync: true, run: (name, args) => RENDERERS[name](...args), cancel() {}, dispose() {} };

export function createRenderer() {
  let worker = null;
  try {
    worker = new Worker(new URL("./render.worker.js", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }
  const queue = [];
  let current = null;
  let next = 1;

  const settle = (job, error, result) => (error ? job.reject(new Error(error)) : job.resolve(result));

  function pump() {
    if (current || !queue.length) return;
    current = queue.shift();
    if (worker) {
      worker.postMessage({ id: current.id, name: current.name, args: current.args });
    } else {
      // no worker support: still yield between renders so timers and the media stream get turns
      const job = current;
      setTimeout(() => {
        try {
          finish(job.id, null, RENDERERS[job.name](...job.args));
        } catch (error) {
          finish(job.id, String(error), null);
        }
      }, 0);
    }
  }

  function finish(id, error, result) {
    if (!current || current.id !== id) return;
    const job = current;
    current = null;
    settle(job, error, result);
    pump();
  }

  if (worker) {
    worker.onmessage = ({ data }) => finish(data.id, data.error, data.result);
    worker.onerror = () => {
      // the worker died: render the rest on the main thread rather than leave the music without sounds
      worker = null;
      const job = current;
      current = null;
      if (job) queue.unshift(job);
      pump();
    };
  }

  return {
    sync: false,
    request(name, args, owner) {
      return new Promise((resolve, reject) => {
        queue.push({ id: next++, name, args, owner, resolve, reject });
        pump();
      });
    },
    // a replaced track must not leave its renders queued ahead of the new one's
    cancel(owner) {
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].owner === owner) queue.splice(i, 1)[0].reject(new Error("cancelled"));
      }
    },
    dispose() {
      worker?.terminate();
      worker = null;
      queue.splice(0).forEach((job) => job.reject(new Error("cancelled")));
    },
  };
}
