// Per-user settings: chosen provider + each provider's API key.
// Stored in the OS app-data dir (not the repo, not .env).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE = path.join(app.getPath('userData'), 'ghost-settings.json');

const DEFAULTS = {
  provider: 'groq', // groq | openai | gemini | anthropic
  sttProvider: 'groq', // used for voice when the answer provider can't transcribe (e.g. Claude)
  keys: { groq: '', openai: '', gemini: '', anthropic: '' },
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    cache.keys = { ...DEFAULTS.keys, ...(cache.keys || {}) };
  } catch (_) {
    cache = JSON.parse(JSON.stringify(DEFAULTS));
  }
  // .env fallback for Groq (back-compat with earlier testing setup)
  if (!cache.keys.groq && process.env.GROQ_API_KEY) {
    cache.keys.groq = process.env.GROQ_API_KEY;
  }
  return cache;
}

function save(next) {
  cache = {
    provider: next.provider || DEFAULTS.provider,
    sttProvider: next.sttProvider || DEFAULTS.sttProvider,
    keys: { ...DEFAULTS.keys, ...(next.keys || {}) },
  };
  try {
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
  } catch (_) {}
  return cache;
}

function current() {
  const s = load();
  return { provider: s.provider, key: s.keys[s.provider] || '' };
}

// Public view for the UI: never leak full keys, just whether each is set.
function publicView() {
  const s = load();
  return {
    provider: s.provider,
    sttProvider: s.sttProvider,
    hasKey: {
      groq: !!s.keys.groq,
      openai: !!s.keys.openai,
      gemini: !!s.keys.gemini,
      anthropic: !!s.keys.anthropic,
    },
  };
}

module.exports = { load, save, current, publicView };
