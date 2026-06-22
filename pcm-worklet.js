// Runs on the audio thread. Forwards raw Float32 frames (at the context's
// native sample rate) to the renderer, which downsamples to 16kHz.
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // copy — the underlying buffer is reused by the engine
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
