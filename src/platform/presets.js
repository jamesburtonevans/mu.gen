// saved presets in the browser for now. an account-backed store can replace this with the same interface
const KEY = "mugen.presets.v1";

export function createPresetStore(storage = globalThis.localStorage) {
  const listeners = new Set();

  const read = () => {
    try {
      const saved = JSON.parse(storage.getItem(KEY));
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  };

  const write = (presets) => {
    try {
      storage.setItem(KEY, JSON.stringify(presets));
    } catch {
      // storage can be full or blocked; the preset just won't persist
    }
    listeners.forEach((fn) => fn(presets));
  };

  return {
    list: read,

    // saving under an existing name replaces it
    save({ name, axes, internals }) {
      const presets = read();
      const existing = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
      const preset = { id: existing?.id ?? `saved-${Date.now()}`, name, axes, internals };
      write(existing ? presets.map((p) => (p === existing ? preset : p)) : [...presets, preset]);
      return preset;
    },

    remove(id) {
      write(read().filter((p) => p.id !== id));
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
