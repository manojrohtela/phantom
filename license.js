// Phantom licensing client (main process).
// Talks to the server license service. The server is the source of truth for
// the trial clock + key binding, so reinstalls / clock changes can't cheat it.

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

let machineIdSync;
try { ({ machineIdSync } = require('node-machine-id')); } catch { machineIdSync = null; }
let QRCode;
try { QRCode = require('qrcode'); } catch { QRCode = null; }

const API_BASE = process.env.PHANTOM_API_BASE
  || 'https://api.heyagenthive.com/voxhire/api/v1/phantom';

function machineId() {
  try {
    if (machineIdSync) return machineIdSync({ original: true });
  } catch { /* fall through */ }
  // Fallback (less reinstall-proof, but stable per OS user/host).
  return `host-${os.hostname()}-${os.userInfo().username}`;
}

function keyFile() { return path.join(app.getPath('userData'), 'phantom-license.json'); }
function loadKey() {
  try { return JSON.parse(fs.readFileSync(keyFile(), 'utf8')).key || null; } catch { return null; }
}
function saveKey(key) {
  try { fs.writeFileSync(keyFile(), JSON.stringify({ key })); } catch { /* ignore */ }
}
function clearKey() { try { fs.unlinkSync(keyFile()); } catch { /* ignore */ } }

async function api(p, body) {
  const res = await fetch(API_BASE + p, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

// Returns { status: 'licensed'|'trial'|'expired', days_left, price_inr, ... }
async function activate(key) {
  const useKey = (key || loadKey() || undefined);
  const data = await api('/activate', { machine_id: machineId(), key: useKey });
  if (data.status === 'licensed' && useKey) saveKey(useKey);
  return data;
}

async function getPricing() { return api('/pricing'); }

async function createOrder(order) {
  return api('/order', { ...order, machine_id: machineId() });
}

async function upiQrDataUrl(price, upiId, upiName) {
  if (!QRCode || !upiId) return null;
  const uri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName || 'AgentHive')}&am=${price}&cu=INR&tn=${encodeURIComponent('Phantom lifetime license')}`;
  try { return await QRCode.toDataURL(uri, { width: 220, margin: 1 }); } catch { return null; }
}

module.exports = { machineId, activate, getPricing, createOrder, upiQrDataUrl, loadKey, saveKey, clearKey };
