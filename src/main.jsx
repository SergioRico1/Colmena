import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/poppins/800.css";
import "./styles/base.css";
import { StrictMode, Suspense, lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, navigate, useRouter } from "./lib/router.jsx";
import { StoreProvider, useStore } from "./lib/store.jsx";
import { routes } from "./routes.jsx";
import WindowChrome from "./components/WindowChrome.jsx";
import ContextMenuLayer from "./components/ContextMenu.jsx";
import LightboxLayer from "./components/room/Lightbox.jsx";
import LinkPreviewLayer from "./components/room/LinkPreview.jsx";
import ConnectionStatus from "./components/ConnectionStatus.jsx";
import UpdateNotice from "./components/UpdateNotice.jsx";
import { listenForNoticeSounds } from "./lib/noticeSounds.js";

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

const OPEN_BEFORE_ONBOARDING = new Set(["Bienvenida", "BienvenidaV2", "AjustesIA", "AjustesIAV2", "DesignGallery", "Mapa", "QuickAsk"]);

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

// «Ha terminado» and «te necesita» each sound their own way (Ajustes › Avisos).
listenForNoticeSounds();
createRoot(document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }))).render(
  <StrictMode>
    <RouterProvider routes={routes}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </RouterProvider>
  </StrictMode>,
);
