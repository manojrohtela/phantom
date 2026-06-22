const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  quit: () => ipcRenderer.send('quit'),

  // audio + pipeline control
  micStart: () => ipcRenderer.send('mic-start'),
  micStop: () => ipcRenderer.send('mic-stop'),
  sendAudio: (int16Buffer) => ipcRenderer.send('audio-chunk', int16Buffer),
  ask: (text) => ipcRenderer.send('ask', text),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (next) => ipcRenderer.invoke('save-settings', next),

  // events from main → renderer
  onToggleMic: (cb) => ipcRenderer.on('toggle-mic', () => cb()),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  onTranscript: (cb) => ipcRenderer.on('transcript', (_e, t) => cb(t)),
  onAnswerStart: (cb) => ipcRenderer.on('answer-start', (_e, q) => cb(q)),
  onAnswerDelta: (cb) => ipcRenderer.on('answer-delta', (_e, d) => cb(d)),
  onAnswerDone: (cb) => ipcRenderer.on('answer-done', () => cb()),

  // trial banner (sent to the overlay when running in trial)
  onTrial: (cb) => ipcRenderer.on('trial-info', (_e, info) => cb(info)),
});

// Licensing API (used by license.html, and activate by the overlay's upgrade button)
contextBridge.exposeInMainWorld('phantomLicense', {
  activate: (key) => ipcRenderer.invoke('license:activate', key),
  pricing: () => ipcRenderer.invoke('license:pricing'),
  order: (data) => ipcRenderer.invoke('license:order', data),
  qr: (price, upi, name) => ipcRenderer.invoke('license:qr', { price, upi, name }),
  proceed: () => ipcRenderer.send('license:proceed'),
  quit: () => ipcRenderer.send('quit'),
});
