import { createContext, startTransition, useContext, useEffect, useMemo, useState } from "react";

// Tiny history router. Plain <a href="/ruta"> links are intercepted globally,
// so screens keep the exact anchor markup of the designs.
const RouterContext = createContext(null);

export function navigate(to, { replace = false } = {}) {
  if (to === location.pathname + location.search) return;
  history[replace ? "replaceState" : "pushState"](null, "", to);
  window.dispatchEvent(new Event("colmena:navigate"));
  window.scrollTo(0, 0);
}

export function matchRoute(routes, pathname) {
  for (const route of routes) {
    const keys = [];
    const pattern = new RegExp(
      "^" + route.path.replace(/\/:([A-Za-z]+)/g, (_, k) => (keys.push(k), "/([^/]+)")) + "/?$",
    );
    const m = pattern.exec(pathname);
    if (m) {
      const params = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return { route, params };
    }
  }
  return null;
}

export function RouterProvider({ routes, children }) {
  const [location_, setLocation] = useState(() => ({ pathname: location.pathname, search: location.search }));
  useEffect(() => {
    // As a transition: React keeps showing the current screen until the next one (its
    // code) is ready, instead of blanking the window in between (no flash).
    const update = () => startTransition(() => setLocation({ pathname: location.pathname, search: location.search }));
    const click = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const a = event.target.closest?.("a[href]");
      if (!a || a.target || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href === "#" || !href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/")) {
        if (href === "#") event.preventDefault();
        return;
      }
      event.preventDefault();
      navigate(href);
    };
    window.addEventListener("popstate", update);
    window.addEventListener("colmena:navigate", update);
    document.addEventListener("click", click);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("colmena:navigate", update);
      document.removeEventListener("click", click);
    };
  }, []);
  const value = useMemo(() => {
    const matched = matchRoute(routes, location_.pathname);
    return {
      ...location_,
      query: Object.fromEntries(new URLSearchParams(location_.search)),
      route: matched?.route || null,
      params: matched?.params || {},
      navigate,
    };
  }, [routes, location_]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  return useContext(RouterContext);
}
