import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/poppins/800.css";
import "./styles/base.css";
import "./styles/palette.css";
import "./styles/responsive.css";
import { StrictMode, Suspense, lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, navigate, useRouter } from "./lib/router.jsx";
import { StoreProvider, useStore } from "./lib/store.jsx";
import { routes } from "./routes.jsx";
import WindowChrome from "./components/WindowChrome.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { logCaught } from "./lib/boundary.js";
import ContextMenuLayer from "./components/ContextMenu.jsx";
import LightboxLayer from "./components/room/Lightbox.jsx";
import LinkPreviewLayer from "./components/room/LinkPreview.jsx";
import ConnectionStatus from "./components/ConnectionStatus.jsx";
import UpdateNotice from "./components/UpdateNotice.jsx";
import UndoToasts from "./components/v2/UndoToasts.jsx";
import DesktopCloudBridge from "./lib/desktopCloud.jsx";
import { reversible } from "./lib/undoToast.js";
import { post } from "./lib/api.js";
import { listenForNoticeSounds } from "./lib/noticeSounds.js";
import { installDragOut } from "./lib/dragOut.js";
import { watchFocusModality } from "./lib/focusModality.js";
import { watchTheme } from "./lib/theme.js";
import { isDesktopApp, watchBreakpoint } from "./lib/breakpoint.js";
import { installLongPress, installTouchReveal } from "./lib/longPress.js";

const live = import.meta.glob("./screens/*.jsx");
// Mockups are only reachable while developing (/_design); the desktop build never ships them as screens.
const designs = import.meta.env.DEV ? import.meta.glob("./design/*.jsx") : {};
const DEV_ONLY = new Set(["DesignGallery", "Mapa"]);
const cache = new Map();
function screenComponent(name) {
  if (!cache.has(name)) {
    const allowed = import.meta.env.DEV || !DEV_ONLY.has(name);
    const loader = (allowed && (live[`./screens/${name}.jsx`] || designs[`./design/${name}.jsx`])) || live["./screens/NotFound.jsx"];
    cache.set(name, loader ? lazy(loader) : () => <p style={{ padding: 40 }}>Pantalla no disponible.</p>);
  }
  return cache.get(name);
}
// Desktop app, local files: warm every screen's code right after start, so moving
// between sections never waits for a download.
function preloadScreens() {
  const all = Object.entries(live).filter(([key]) => import.meta.env.DEV || !DEV_ONLY.has(key.slice(10, -4)));
  const run = () => all.forEach(([, load]) => load().catch(() => {}));
  (window.requestIdleCallback || ((fn) => setTimeout(fn, 300)))(run);
}
const Palette = live["./screens/CommandPalette.jsx"] ? lazy(live["./screens/CommandPalette.jsx"]) : null;

const OPEN_BEFORE_ONBOARDING = new Set(["BienvenidaV2", "AjustesIAV2", "DesignGallery", "Mapa", "QuickAsk"]);

function App() {
  const { route, params, query, pathname } = useRouter();
  const { ready, settings } = useStore();
  const Screen = screenComponent(route?.screen || "NotFound");
  useEffect(() => {
    document.title = "Colmena";
  }, [route]);
  // First run: welcome flow before anything else.
  useEffect(() => {
    if (ready && settings.onboarded === false && !OPEN_BEFORE_ONBOARDING.has(route?.screen)) navigate("/bienvenida", { replace: true });
  }, [ready, settings.onboarded, route, pathname]);
  useEffect(preloadScreens, []);
  // «Pregunta rápida» is a window of the desktop app; in a browser its address opens Inicio.
  useEffect(() => { if (route?.screen === "QuickAsk" && !isDesktopApp()) navigate("/", { replace: true }); }, [route]);
  // Light or dark (Ajustes › General › Tema): before the settings arrive, theme-boot.js already
  // applied the last choice; from then on the setting and, for «Sistema», the system decide.
  const themeMode = ready ? settings.theme || "system" : null;
  useEffect(() => (themeMode ? watchTheme(themeMode) : undefined), [themeMode]);
  // After an update your bots got colours of their own (server/bot-looks.mjs): said once, quietly,
  // with «Deshacer» (the factory colours back).
  const looksNotice = ready && settings.onboarded !== false && !!settings.botLooks?.notice;
  useEffect(() => {
    if (!looksNotice) return;
    post("/bots/looks/seen").catch(() => {});
    reversible({ id: "bot-looks", text: "Tus bots tienen colores propios para que tus compañeros los distingan de los suyos", ms: 15000, undo: () => post("/bots/looks/undo") });
  }, [looksNotice]);
  // «Pregunta rápida» is its own small window: just the card, no chrome or app overlays.
  if (route?.screen === "QuickAsk") return <Suspense fallback={null}><Screen params={params} query={query} /></Suspense>;
  return (
    <>
      <WindowChrome />
      <ContextMenuLayer />
      <LightboxLayer />
      <LinkPreviewLayer />
      <ConnectionStatus />
      <UpdateNotice />
      <UndoToasts />
      <DesktopCloudBridge />
      <Suspense fallback={null}>
        <Screen params={params} query={query} />
        {Palette && route?.screen !== "DesignGallery" ? <Palette /> : null}
      </Suspense>
    </>
  );
}

// A file dropped anywhere outside a composer must not open in the window (Electron would
// navigate to it and leave Colmena). Composers handle their own drops before this.
for (const type of ["dragover", "drop"]) {
  window.addEventListener(type, (e) => {
    if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault();
  });
}

// Files Colmena shows drag out into other apps (desktop app; src/lib/dragOut.js).
installDragOut();
// Phone, tablet or laptop, and a plain browser or the desktop app (styles/responsive.css).
watchBreakpoint();
// In a browser on a touch screen a long press opens what a right-click opens (lib/longPress.js).
// A tap on a message shows its toolbar, which a mouse finds on hover.
if (!isDesktopApp()) { installLongPress(); installTouchReveal(); }
// Text fields show their focus ring only while you move with the keyboard (styles/base.css).
watchFocusModality();
// «Ha terminado» and «te necesita» each sound their own way (Ajustes › Avisos).
listenForNoticeSounds();
// An error a boundary catches is written to the console once (lib/boundary.js).
createRoot(document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" })), { onCaughtError: logCaught }).render(
  <StrictMode>
    {/* Outermost: a render error anywhere (or a screen whose code no longer loads) shows the
        crash screen, with the window buttons, instead of a blank frameless window. */}
    <ErrorBoundary>
      <RouterProvider routes={routes}>
        <StoreProvider>
          <App />
        </StoreProvider>
      </RouterProvider>
    </ErrorBoundary>
  </StrictMode>,
);
