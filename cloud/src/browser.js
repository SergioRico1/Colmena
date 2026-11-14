// Browser Rendering for the bots' browser (server/cloud/browser-cloud.mjs): one headless Chromium
// per workspace object, kept while pages are open (keep_alive) and closed when the last page goes.
// Each page is handed over as a CDP session: the browser module drives it exactly like the
// desktop's Electron browser.
import puppeteer from "@cloudflare/puppeteer";

const KEEP_ALIVE_MS = 10 * 60 * 1000;

export function renderingDriver(binding, { onLaunch = () => {} } = {}) {
  let browser = null, launching = null;
  async function connected() {
    if (browser?.isConnected()) return browser;
    launching ??= (async () => {
      const t0 = Date.now();
      browser = await puppeteer.launch(binding, { keep_alive: KEEP_ALIVE_MS });
      onLaunch(Date.now() - t0);
      return browser;
    })().finally(() => { launching = null; });
    return launching;
  }
  return {
    async open() {
      const b = await connected();
      const page = await b.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      const session = await page.createCDPSession();
      return {
        send: (method, params) => session.send(method, params),
        on: (event, fn) => session.on(event, fn),
        close: async () => { try { await session.detach(); } catch {} await page.close(); },
      };
    },
    async close() {
      const b = browser;
      browser = null;
      if (b) await b.close().catch(() => {});
    },
  };
}
