"use strict";
// Screenshots for «Pregunta rápida» (OpenClaw Quick Chat «Capture Window…» / «Capture Area…»):
// the window you came from, another window picked from a list, or an area of the screen
// chosen over a frozen picture of it (dimmed, with a live size label). Images go out as
// JPEG, long edge ≤ 1600 px, quality 80, at most 3.5 MB (OpenClaw ChatImageProcessor).
const path = require("node:path");
const { BrowserWindow, desktopCapturer, ipcMain, screen } = require("electron");

const LONG_EDGE = 1600;
const MAX_BYTES = 3.5 * 1024 * 1024;
const MIN_AREA = 8; // a drag smaller than 8×8 (or a plain click) cancels

/** nativeImage → {dataUrl, width, height, bytes}, resized and compressed for the model. */
function toJpeg(image) {
  let img = image;
  const { width, height } = img.getSize();
  const scale = Math.min(1, LONG_EDGE / Math.max(width, height));
  if (scale < 1) img = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: "best" });
  let quality = 80, buf = img.toJPEG(quality);
  while (buf.length > MAX_BYTES && quality > 40) buf = img.toJPEG((quality -= 15));
  const size = img.getSize();
  return { dataUrl: "data:image/jpeg;base64," + buf.toString("base64"), width: size.width, height: size.height, bytes: buf.length };
}

/** Windows on screen, newest Electron naming «window:<hwnd>:0», with a small thumbnail. */
async function listWindows({ exclude = () => false } = {}) {
  const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: true });
  return sources
    .filter((s) => s.name && !s.thumbnail.isEmpty() && !exclude(s))
    .slice(0, 24)
    .map((s) => ({ id: s.id, hwnd: (/^window:(\d+):/.exec(s.id) || [])[1] || null, name: s.name.slice(0, 120), thumb: s.thumbnail.toDataURL(), icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null }));
}

/** One window at full size, by its capturer id or by HWND. */
async function captureWindow({ id = null, hwnd = null }) {
  const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 2400, height: 2400 } });
  const source = sources.find((s) => (id && s.id === id) || (hwnd && s.id.startsWith("window:" + hwnd + ":")));
  if (!source || source.thumbnail.isEmpty()) throw Error("No pude capturar esa ventana: puede que esté minimizada o se haya cerrado.");
  return { ...toJpeg(source.thumbnail), name: source.name };
}

/**
 * An area of any screen: each display is frozen first and shown full-screen; you drag a
 * rectangle on one of them. Resolves the cropped picture, or null if you cancel (Esc, a
 * click, a drag under 8×8).
 */
async function captureArea({ origin }) {
  const displays = screen.getAllDisplays();
  const biggest = displays.reduce((m, d) => ({ width: Math.max(m.width, d.size.width * d.scaleFactor), height: Math.max(m.height, d.size.height * d.scaleFactor) }), { width: 0, height: 0 });
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: biggest });
  const frozen = displays.map((d, i) => ({ display: d, image: (sources.find((s) => String(s.display_id) === String(d.id)) || sources[i])?.thumbnail || null })).filter((f) => f.image && !f.image.isEmpty());
  if (!frozen.length) throw Error("No pude ver la pantalla.");
  return await new Promise((resolve) => {
    const windows = [];
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("colmena-area", onMessage);
      for (const w of windows) if (!w.isDestroyed()) w.destroy();
      resolve(value);
    };
    const onMessage = (event, action, payload) => {
      const index = windows.findIndex((w) => !w.isDestroyed() && w.webContents === event.sender);
      if (index < 0) return;
      if (action === "ready") return event.sender.send("colmena-area-image", { image: frozen[index].image.toDataURL(), scale: frozen[index].display.scaleFactor });
      if (action === "cancel") return finish(null);
      if (action === "done") {
        const { x, y, width, height } = payload || {};
        if (!(width >= MIN_AREA && height >= MIN_AREA)) return finish(null);
        const f = frozen[index];
        const img = f.image;
        const real = img.getSize();
        // The frozen picture is in physical pixels; the selection came in window (DIP) units.
        const kx = real.width / f.display.bounds.width, ky = real.height / f.display.bounds.height;
        const rect = { x: Math.max(0, Math.round(x * kx)), y: Math.max(0, Math.round(y * ky)), width: Math.round(width * kx), height: Math.round(height * ky) };
        rect.width = Math.min(rect.width, real.width - rect.x);
        rect.height = Math.min(rect.height, real.height - rect.y);
        try { finish({ ...toJpeg(img.crop(rect)), name: "Zona de la pantalla" }); } catch { finish(null); }
      }
    };
    ipcMain.on("colmena-area", onMessage);
    for (const f of frozen) {
      const b = f.display.bounds;
      const win = new BrowserWindow({
        x: b.x, y: b.y, width: b.width, height: b.height, frame: false, transparent: false, backgroundColor: "#12131A",
        alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, show: false, hasShadow: false, enableLargerThanScreen: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, "preload-area.cjs") },
      });
      win.setAlwaysOnTop(true, "screen-saver");
      win.setBounds(b);
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (e) => e.preventDefault());
      win.on("closed", () => { if (windows.every((w) => w.isDestroyed())) finish(null); });
      win.loadFile(path.join(__dirname, "area.html"));
      win.once("ready-to-show", () => { win.show(); if (f.display.id === screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id) win.focus(); });
      windows.push(win);
    }
    void origin;
  });
}

/** The whole screen the given bounds are on (or the one under the cursor), at full size. */
async function captureScreen({ near = null } = {}) {
  const display = near ? screen.getDisplayMatching(near) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: size });
  const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw Error("No pude ver la pantalla.");
  return { ...toJpeg(source.thumbnail), name: "Pantalla" };
}

module.exports = { listWindows, captureWindow, captureArea, captureScreen, toJpeg };
