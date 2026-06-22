// Main-process pipeline. Provider-agnostic: Groq / OpenAI / Gemini, user's own key.
//   mic PCM → silence-segmented utterance → STT → LLM (streamed) → overlay
// Keys live here (main), never in the renderer.
require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ipcMain } = require('electron');
const settings = require('./settings');

const SYSTEM_PROMPT = `You are a real-time interview/meeting assistant. You receive the
interviewer's spoken question (transcribed). Reply with a concise, well-structured answer the
user can speak aloud: lead with the direct answer, then 2-4 short supporting bullets. No preamble,
no "Here is" — just the answer. Keep it under ~120 words unless the question demands more.`;

// Per-provider config. openai + groq share the OpenAI-compatible wire format.
const PROVIDERS = {
  groq: {
    kind: 'openai',
    chatUrl: 'https://api.groq.com/openai/v1/chat/completions',
    chatModel: 'llama-3.3-70b-versatile',
    sttUrl: 'https://api.groq.com/openai/v1/audio/transcriptions',
    sttModel: 'whisper-large-v3-turbo',
  },
  openai: {
    kind: 'openai',
    chatUrl: 'https://api.openai.com/v1/chat/completions',
    chatModel: 'gpt-4o-mini',
    sttUrl: 'https://api.openai.com/v1/audio/transcriptions',
    sttModel: 'whisper-1',
  },
  gemini: {
    kind: 'gemini',
    chatModel: 'gemini-2.0-flash',
    sttModel: 'gemini-2.0-flash',
  },
  anthropic: {
    kind: 'anthropic',
    chatUrl: 'https://api.anthropic.com/v1/messages',
    chatModel: 'claude-haiku-4-5',
    // Anthropic has no speech-to-text — STT falls back to another provider.
  },
};

// Which providers can transcribe audio.
function sttCapable(provider) {
  const c = PROVIDERS[provider];
  return !!(c && (c.sttUrl || c.kind === 'gemini'));
}

// ---- VAD / segmentation tuning ----
const SAMPLE_RATE = 16000;
const SILENCE_RMS = 0.012;
const MIN_SPEECH_MS = 400;
const HANG_MS = 700;
const MAX_UTTERANCE_MS = 20000;

let win = null;
let listening = false;

let chunks = [];
let speechMs = 0;
let silenceMs = 0;
let totalMs = 0;
let inSpeech = false;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function resetSegment() {
  chunks = []; speechMs = 0; silenceMs = 0; totalMs = 0; inSpeech = false;
}

function rmsOf(int16) {
  let sum = 0;
  for (let i = 0; i < int16.length; i++) { const s = int16[i] / 32768; sum += s * s; }
  return Math.sqrt(sum / Math.max(1, int16.length));
}

function buildWav(int16Chunks) {
  let total = 0;
  for (const c of int16Chunks) total += c.length;
  const dataBytes = total * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40);
  let off = 44;
  for (const c of int16Chunks) {
    for (let i = 0; i < c.length; i++) { buf.writeInt16LE(c[i], off); off += 2; }
  }
  return buf;
}

// ---- Generic SSE line reader over a fetch Response ----
async function* sseLines(res) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

// ---- STT ----
async function transcribe(wav, prov, cfg, key) {
  if (cfg.kind === 'openai') {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', cfg.sttModel);
    form.append('language', 'en');
    const res = await fetch(cfg.sttUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
    const j = await res.json();
    return (j.text || '').trim();
  }
  // gemini: inline audio → transcript
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.sttModel}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: 'Transcribe this audio verbatim. Return only the transcript text.' },
          { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return (j.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

// ---- LLM (streaming) ----
async function streamAnswer(question, cfg, key) {
  if (cfg.kind === 'openai') {
    const res = await fetch(cfg.chatUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.chatModel,
        stream: true,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: question },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    for await (const data of sseLines(res)) {
      if (data === '[DONE]') break;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) send('answer-delta', delta);
      } catch (_) {}
    }
    return;
  }
  if (cfg.kind === 'anthropic') {
    const res = await fetch(cfg.chatUrl, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.chatModel,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        stream: true,
        messages: [{ role: 'user', content: question }],
      }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    for await (const data of sseLines(res)) {
      try {
        const j = JSON.parse(data);
        if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') {
          send('answer-delta', j.delta.text);
        }
      } catch (_) {}
    }
    return;
  }
  // gemini streaming
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.chatModel}:streamGenerateContent?alt=sse&key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: question }] }],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  for await (const data of sseLines(res)) {
    try {
      const t = JSON.parse(data).candidates?.[0]?.content?.parts?.[0]?.text;
      if (t) send('answer-delta', t);
    } catch (_) {}
  }
}

// Pick an STT-capable provider: prefer the active one, else any key we have.
function resolveSTT() {
  const s = settings.load();
  const all = s.keys;
  // Prefer the user's chosen STT provider, then the active one, then any with a key.
  for (const p of [s.sttProvider, s.provider, 'groq', 'openai', 'gemini']) {
    if (sttCapable(p) && all[p]) return { provider: p, cfg: PROVIDERS[p], key: all[p] };
  }
  return null;
}

function activeProvider() {
  const { provider, key } = settings.current();
  const cfg = PROVIDERS[provider] || PROVIDERS.groq;
  return { provider, cfg, key };
}

async function answerQuestion(question) {
  const { provider, cfg, key } = activeProvider();
  if (!key) {
    send('answer-start', question);
    send('answer-delta', `[No API key for "${provider}". Open Settings (⚙) and add one.]`);
    send('answer-done');
    return;
  }
  try {
    send('status', 'thinking…');
    send('answer-start', question);
    await streamAnswer(question, cfg, key);
    send('answer-done');
    send('status', listening ? 'listening' : 'mic off');
  } catch (err) {
    send('answer-delta', `\n[error: ${err.message}]`);
    send('answer-done');
  }
}

async function flushUtterance() {
  if (speechMs < MIN_SPEECH_MS || chunks.length === 0) { resetSegment(); return; }
  const wav = buildWav(chunks);
  resetSegment();

  const stt = resolveSTT();
  if (!stt) {
    send('status', 'No speech-to-text key — add a Groq, OpenAI, or Gemini key (Claude has no STT). Typed box still works.');
    return;
  }

  send('status', 'transcribing…');
  try {
    const text = await transcribe(wav, stt.provider, stt.cfg, stt.key);
    if (text) {
      send('transcript', { text, final: true });
      await answerQuestion(text);
    } else {
      send('status', 'listening');
    }
  } catch (err) {
    send('status', err.message);
  }
}

function feedAudio(int16) {
  if (!listening) return;
  const durMs = (int16.length / SAMPLE_RATE) * 1000;
  totalMs += durMs;
  const rms = rmsOf(int16);
  if (rms >= SILENCE_RMS) {
    inSpeech = true; speechMs += durMs; silenceMs = 0; chunks.push(int16);
  } else if (inSpeech) {
    silenceMs += durMs; chunks.push(int16);
    if (silenceMs >= HANG_MS) flushUtterance();
  }
  if (totalMs >= MAX_UTTERANCE_MS && inSpeech) flushUtterance();
}

function register(targetWindow) {
  win = targetWindow;

  ipcMain.on('mic-start', () => {
    listening = true; resetSegment();
    send('status', resolveSTT() ? 'listening' : 'No speech-to-text key — add Groq, OpenAI, or Gemini in Settings (⚙)');
  });
  ipcMain.on('mic-stop', () => { listening = false; resetSegment(); send('status', 'mic off'); });
  ipcMain.on('audio-chunk', (_e, buf) => feedAudio(new Int16Array(buf)));
  ipcMain.on('ask', (_e, text) => { if (text && text.trim()) answerQuestion(text.trim()); });

  ipcMain.handle('get-settings', () => settings.publicView());
  ipcMain.handle('save-settings', (_e, next) => {
    const cur = settings.load();
    // merge: only overwrite a key if a non-empty value was provided
    const keys = { ...cur.keys };
    if (next.keys) {
      for (const p of Object.keys(next.keys)) {
        if (next.keys[p]) keys[p] = next.keys[p];
      }
    }
    settings.save({
      provider: next.provider || cur.provider,
      sttProvider: next.sttProvider || cur.sttProvider,
      keys,
    });
    return settings.publicView();
  });
}

module.exports = { register };
