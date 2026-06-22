// Renderer-side audio capture: mic → 16kHz mono Int16 PCM → main process.
const TARGET_RATE = 16000;
const BATCH_SAMPLES = 1600; // ~100ms at 16kHz before sending to main

let audioCtx = null;
let stream = null;
let node = null;
let running = false;
let pending = []; // accumulated Int16 samples awaiting a 100ms batch
let pendingLen = 0;

// Downsample a Float32 frame from inputRate to 16kHz, return Int16Array.
function downsampleToInt16(float32, inputRate) {
  if (inputRate === TARGET_RATE) {
    return floatToInt16(float32);
  }
  const ratio = inputRate / TARGET_RATE;
  const outLength = Math.floor(float32.length / ratio);
  const out = new Int16Array(outLength);
  let pos = 0;
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < float32.length; j++) {
      sum += float32[j];
      count++;
    }
    const sample = count > 0 ? sum / count : 0;
    out[pos++] = clampInt16(sample);
  }
  return out;
}

function floatToInt16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) out[i] = clampInt16(float32[i]);
  return out;
}

function clampInt16(s) {
  s = Math.max(-1, Math.min(1, s));
  return s < 0 ? s * 0x8000 : s * 0x7fff;
}

async function startMic() {
  if (running) return;
  running = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    audioCtx = new AudioContext();
    await audioCtx.audioWorklet.addModule('pcm-worklet.js');
    const source = audioCtx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(audioCtx, 'pcm-processor');
    const inputRate = audioCtx.sampleRate;

    node.port.onmessage = (e) => {
      const int16 = downsampleToInt16(e.data, inputRate);
      pending.push(int16);
      pendingLen += int16.length;
      if (pendingLen >= BATCH_SAMPLES) {
        const batch = new Int16Array(pendingLen);
        let off = 0;
        for (const c of pending) { batch.set(c, off); off += c.length; }
        pending = [];
        pendingLen = 0;
        window.overlay.sendAudio(batch.buffer);
      }
    };

    source.connect(node);
    // Worklet needs a sink to keep pulling; route to a muted gain.
    const sink = audioCtx.createGain();
    sink.gain.value = 0;
    node.connect(sink);
    sink.connect(audioCtx.destination);

    window.overlay.micStart();
  } catch (err) {
    running = false;
    window.dispatchEvent(new CustomEvent('mic-error', { detail: err.message }));
  }
}

function stopMic() {
  if (!running) return;
  running = false;
  pending = [];
  pendingLen = 0;
  window.overlay.micStop();
  if (node) { node.disconnect(); node = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
}

window.ghostAudio = {
  toggle: () => (running ? stopMic() : startMic()),
  isRunning: () => running,
};
