// How many components re-render while a bot streams (dev aid, no browser needed).
// It bundles the real store, Markdown and «Código» hooks with esbuild, mounts them in a
// linkedom document with a scripted /api/events, plays N frames of live text and counts
// renders:
//   - app:      80 components that call useStore() and do not show the stream (shell, sidebar…)
//   - live row: the one that shows the text being written
//   - markdown: parses of a finished answer during the stream, and while its parent re-renders
//   - código:   renders of the task screen and of its live text while deltas arrive
// Usage: node scripts/perf-renders.mjs [--frames=200] [--src=<another checkout's src>]
// With --src it measures that tree instead (e.g. `git archive <commit> src | tar -x -C tmp`),
// to compare before and after; trees without src/lib/liveStore.js read `live` from useStore().
import { build } from "esbuild";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const flag = (name, def) => { const a = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`)); return a ? a.split("=").slice(1).join("=") : def; };
const frames = Number(flag("frames", 200));
const src = path.resolve(flag("src", path.join(root, "src")));
const CALLERS = 80;

const hasLiveStore = existsSync(path.join(src, "lib/liveStore.js"));
const hasCodeLive = readFileSync(path.join(src, "components/v2/code/useCode.js"), "utf8").includes("export function useCodeLive");
const S = (p) => JSON.stringify(path.join(src, p).replace(/\\/g, "/"));

const entry = `
import { act, createElement as h, useState } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider, useStore } from ${S("lib/store.jsx")};
import Markdown from ${S("components/room/Markdown.jsx")};
import * as code from ${S("components/v2/code/useCode.js")};
${hasLiveStore ? `import { useLiveText } from ${S("lib/liveStore.js")};` : `const useLiveText = (id) => useStore().live?.[id]?.text || "";`}

export const counts = { app: 0, live: 0, task: 0, codeLive: 0 };
let text = "";
const ANSWER = "# Title\\n\\nA **finished** answer with a list:\\n\\n- one\\n- two";
function Caller() { useStore(); counts.app++; return null; }
function LiveRow() { text = useLiveText("s1"); counts.live++; return h("p", null, text); }
function App() {
  return h(StoreProvider, null, Array.from({ length: ${CALLERS} }, (_, i) => h(Caller, { key: i })), h(LiveRow), h(Markdown, { text: ANSWER }));
}
let bump = null;
function Answers() {
  const [, set] = useState(0);
  bump = () => set((n) => n + 1);
  return h(StoreProvider, null, h(Markdown, { text: ANSWER, style: { color: "#12131A" } }));
}
function CodeLive({ live }) { const own = code.useCodeLive ? code.useCodeLive("t1") : live; counts.codeLive++; text = own; return h("p", null, own); }
function Task() { const t = code.useCodeTask("t1"); counts.task++; return h("div", null, h(CodeLive, { live: t.live })); }

const tick = () => act(() => new Promise((r) => setTimeout(r, 5)));
export async function run(frames, sources, parses) {
  const out = {};
  const mount = async (el) => { const root = createRoot(document.createElement("div")); await act(() => root.render(el)); await tick(); return root; };
  const send = (url, event) => sources.filter((s) => s.url === url).forEach((s) => s.onmessage?.({ data: JSON.stringify(event) }));

  let root = await mount(h(App));
  Object.keys(counts).forEach((k) => (counts[k] = 0));
  parses.n = 0;
  for (let i = 0; i < frames; i++) { await act(() => send("/api/events", { type: "delta", stepId: "s1", botId: "b1", mission: "m1", text: "word " })); await tick(); }
  out.app = counts.app / ${CALLERS}; out.live = counts.live; out.liveText = text.length; out.streamParses = parses.n;
  await act(() => root.unmount());

  root = await mount(h(Answers));
  parses.n = 0;
  for (let i = 0; i < frames; i++) { await act(() => bump()); }
  out.markdown = parses.n;
  await act(() => root.unmount());

  root = await mount(h(Task));
  counts.task = 0; counts.codeLive = 0;
  for (let i = 0; i < frames; i++) { await act(() => send("/api/code/events", { type: "delta", task: "t1", text: "word " })); await tick(); }
  out.task = counts.task; out.codeLive = counts.codeLive; out.codeText = text.length;
  await act(() => root.unmount());
  return out;
}
`;

const dir = path.join(root, "node_modules/.cache/perf-renders");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "entry.jsx"), entry);
const outfile = path.join(dir, "bundle.mjs");
await build({
  entryPoints: [path.join(dir, "entry.jsx")], outfile, bundle: true, format: "esm", platform: "node", jsx: "automatic", logLevel: "error",
  external: ["react", "react-dom", "react-dom/*", "react/*"], nodePaths: [path.join(root, "node_modules")], loader: { ".css": "empty" },
  define: { "import.meta.env.DEV": "false" }, mainFields: ["module", "main"],
  banner: { js: `import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);` },
  plugins: [{
    name: "count-parses",
    // Every render of <ReactMarkdown> is a parse: counted here, the real one is not needed.
    setup(b) {
      b.onResolve({ filter: /^react-markdown$/ }, () => ({ path: "react-markdown", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: `export default function ReactMarkdown({ children }) { globalThis.__parses.n++; return children; }`, loader: "js" }));
    },
  }],
});

// A document, a scripted event stream and an API that answers with an empty app.
const { parseHTML } = await import("linkedom");
const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
const sources = [];
Object.assign(globalThis, {
  window, document, IS_REACT_ACT_ENVIRONMENT: true, __parses: { n: 0 },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout,
  EventSource: class { constructor(url) { this.url = url; sources.push(this); } close() { sources.splice(sources.indexOf(this), 1); } },
  fetch: async (url) => ({ ok: true, status: 200, json: async () => (String(url).startsWith("/api/code/tasks/") ? { task: { id: "t1" }, project: null, items: [], live: null, models: [], commands: [] } : { bots: [{ id: "b1", name: "Vera" }], missions: [] }) }),
});
for (const key of ["navigator", "HTMLElement", "Node", "Element", "Event", "CustomEvent", "MutationObserver"]) if (!(key in globalThis) && window[key]) globalThis[key] = window[key];
window.addEventListener ||= () => {};
window.removeEventListener ||= () => {};

const { run } = await import(pathToFileURL(outfile).href + "?" + Date.now());
const r = await run(frames, sources, globalThis.__parses);
rmSync(dir, { recursive: true, force: true });
console.log(`${path.relative(root, src) || src}: ${frames} frames of live text`);
console.log(`  renders of each useStore() caller that does not show the stream: ${r.app}`);
console.log(`  renders of the row that shows it: ${r.live} (${r.liveText} characters on screen)`);
console.log(`  parses of a finished answer during the stream: ${r.streamParses}`);
console.log(`  parses of a finished answer while its parent re-renders ${frames} times: ${r.markdown}`);
console.log(`  Código: renders of the task screen ${r.task}, of its live text ${r.codeLive} (${r.codeText} characters on screen)`);
process.exit(0);
