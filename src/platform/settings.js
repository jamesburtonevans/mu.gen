// the last settings, so the page comes back as it was left
const KEY = "mugen.settings.v1";

export function loadSettings(storage = globalThis.localStorage) {
  try {
    return JSON.parse(storage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage can be full or blocked; settings just won't persist
  }
}
