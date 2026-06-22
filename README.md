# Phantom

A frameless, transparent, always-on-top overlay window that is **excluded from screen
capture / screen sharing** — visible on your physical display, but absent from
Zoom / Google Meet / Teams / QuickTime / OBS captures — with a live
**audio → speech-to-text → LLM** answer pipeline running entirely on **Groq's free tier**.

```
mic / system audio → 16kHz PCM → silence-segmented utterance
                                        │
                          Groq Whisper (STT) → Groq Llama (streaming)
                                        │
                          answer streamed onto the hidden overlay
```

Both STT and the LLM use **Groq's free tier** — one key, no Anthropic/Deepgram billing.
Because Groq has no streaming STT, the main process segments speech on a ~0.7s pause
([pipeline.js](pipeline.js)) and transcribes each utterance.

## How the invisibility works

One Electron call does it cross-platform:

```js
win.setContentProtection(true);
```

Under the hood:
- **macOS** → `NSWindow.sharingType = .none` (excluded from ScreenCaptureKit streams)
- **Windows** → `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`

### Limitations (be honest about these)
- Defeats **software** screen capture only. A **phone camera** pointed at the screen still sees it.
- Some **hardware HDMI capture cards** and certain remote-desktop paths can still grab it.
- Effectiveness varies by OS version and GPU driver — always test against your real target app.

## Run

```bash
npm install
npm start
```

Then click **⚙ Settings**, pick a **provider** (Groq / OpenAI / Gemini), and paste **your own
API key**. The key is stored locally (OS app-data dir, not the repo) and read only in the
**main process** ([pipeline.js](pipeline.js)) — never exposed to the renderer. No `.env` needed
(though a `GROQ_API_KEY` in `.env` is still honored as a fallback).

| Provider | Where to get a key | STT model | Answer model |
|---|---|---|---|
| **Groq** (free) | console.groq.com | whisper-large-v3-turbo | llama-3.3-70b-versatile |
| **OpenAI** | platform.openai.com/api-keys | whisper-1 | gpt-4o-mini |
| **Gemini** (free tier) | aistudio.google.com/apikey | gemini-2.0-flash | gemini-2.0-flash |
| **Claude** | console.anthropic.com | — (no STT) | claude-haiku-4-5 |

> **Claude has no speech-to-text.** Pick Claude for the *answer*, but voice transcription falls
> back to whichever Groq/OpenAI/Gemini key you've also added. The typed box always works.

### Using it
- Press **⌘/Ctrl+M** (or the **Listen** button) to start the mic. The interviewer's speech is
  transcribed live; each completed utterance is sent to Claude and the answer streams onto the
  overlay.
- Or type a question in the box and press Enter.
- To capture the **other party's** voice (not just your mic), route system audio in with a
  virtual device — **BlackHole** on macOS, **VB-Cable** / WASAPI loopback on Windows — and pick
  it as the input device.

### Models (free tier)
In [pipeline.js](pipeline.js): `STT_MODEL = whisper-large-v3-turbo`, `LLM_MODEL =
llama-3.3-70b-versatile`. Swap either for any other Groq model. Groq's free tier is
rate-limited; for production you'd move the LLM to Claude (`claude-haiku-4-5` /
`claude-opus-4-8`) for higher answer quality.

> Note: this shell sets `ELECTRON_RUN_AS_NODE` unset in the `start` script. If you launch
> Electron some other way and see `Cannot read properties of undefined (reading 'whenReady')`,
> that env var is the cause — unset it.

## Verify it's invisible
1. `npm start` — the panel appears top-right.
2. Start a screen share / screen recording (QuickTime "New Screen Recording", or share your
   whole screen in Zoom).
3. The overlay should **not** appear in the shared/recorded video, but stays visible to you.

## Shortcuts (global)
| Keys | Action |
|------|--------|
| `⌘/Ctrl` + `\` | show / hide |
| `⌘/Ctrl` + `M` | start / stop listening |
| `⌘/Ctrl` + arrows | move window |
| `⌘/Ctrl` + `[` / `]` | dim / brighten |

## Files
- `main.js` — window creation, content protection, global shortcuts
- `pipeline.js` — main-process audio → Groq Whisper STT (silence-segmented) → Groq Llama streaming (holds the key)
- `audio.js` + `pcm-worklet.js` — renderer mic capture → 16kHz Int16 PCM, batched to 100ms
- `preload.js` — sandboxed IPC bridge
- `index.html` — overlay UI (transcript + streaming answer + question box)

## Next steps
1. System-audio capture wiring (virtual-device setup, or ScreenCaptureKit audio on macOS)
2. Conversation memory (carry recent Q&A as context instead of one-shot questions)
3. Package + code-sign with `electron-builder`
