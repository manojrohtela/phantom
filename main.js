const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const pipeline = require('./pipeline');
const license = require('./license');

let win = null;
let licenseWin = null;
let visible = true;
let trialInfo = null;   // { days_left } when running in trial

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = 460;

  win = new BrowserWindow({
    width: winWidth,
    height: 600,
    x: width - winWidth - 24,
    y: 60,
    frame: false,            // no title bar / chrome
    transparent: true,       // transparent background
    alwaysOnTop: true,       // floats above everything
    resizable: true,
    skipTaskbar: true,       // hidden from taskbar / dock app-switcher
    hasShadow: false,
    focusable: true,         // needed so the input box can receive typing
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // THE key call: excludes this window from screen capture / sharing.
  // macOS -> NSWindow.sharingType = .none
  // Windows -> SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)
  win.setContentProtection(true);

  // Keep it above full-screen apps (Zoom in full screen, etc.)
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.loadFile('index.html');
  pipeline.register(win);

  // Show the trial banner once the overlay is ready.
  if (trialInfo) {
    win.webContents.once('did-finish-load', () => win.webContents.send('trial-info', trialInfo));
  }

  win.on('closed', () => { win = null; });
}

// The license / buy screen (a normal, visible, capturable window).
function createLicenseWindow() {
  licenseWin = new BrowserWindow({
    width: 600, height: 720, resizable: false, title: 'Phantom — Activate',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  licenseWin.loadFile('license.html');
  licenseWin.on('closed', () => { licenseWin = null; });
}

// Decide what to open on launch based on license status.
async function gateAndLaunch() {
  let status;
  try {
    status = await license.activate();   // uses saved key + machine id
  } catch (e) {
    // The product needs internet to work anyway, so fail OPEN on a network
    // error rather than punish a legit user; the server re-checks next launch.
    status = { status: 'trial', days_left: null, _offline: true };
  }
  if (status.status === 'expired') {
    createLicenseWindow();
  } else {
    trialInfo = status.status === 'trial' ? { days_left: status.days_left } : null;
    createWindow();
    registerShortcuts();
  }
}

function registerShortcuts() {
  // Toggle show/hide
  globalShortcut.register('CommandOrControl+\\', () => {
    if (!win) return;
    visible = !visible;
    visible ? win.showInactive() : win.hide();
  });

  // Nudge window around without touching the mouse
  const move = (dx, dy) => () => {
    if (!win) return;
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  };
  globalShortcut.register('CommandOrControl+Up', move(0, -40));
  globalShortcut.register('CommandOrControl+Down', move(0, 40));
  globalShortcut.register('CommandOrControl+Left', move(-40, 0));
  globalShortcut.register('CommandOrControl+Right', move(40, 0));

  // Toggle the microphone / live listening
  globalShortcut.register('CommandOrControl+M', () => {
    if (win) win.webContents.send('toggle-mic');
  });

  // Opacity down / up
  globalShortcut.register('CommandOrControl+[', () => {
    if (win) win.setOpacity(Math.max(0.15, win.getOpacity() - 0.1));
  });
  globalShortcut.register('CommandOrControl+]', () => {
    if (win) win.setOpacity(Math.min(1, win.getOpacity() + 0.1));
  });
}

app.whenReady().then(() => {
  gateAndLaunch();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !licenseWin) createWindow();
  });
});

// ─── Licensing IPC ───────────────────────────────────────────
ipcMain.handle('license:activate', (_e, key) => license.activate(key));
ipcMain.handle('license:pricing', () => license.getPricing());
ipcMain.handle('license:order', (_e, data) => license.createOrder(data));
ipcMain.handle('license:qr', (_e, { price, upi, name } = {}) => license.upiQrDataUrl(price, upi, name));
ipcMain.on('license:proceed', () => {
  trialInfo = null;
  if (licenseWin) licenseWin.close();
  if (!win) { createWindow(); registerShortcuts(); }
});

ipcMain.on('quit', () => app.quit());

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
