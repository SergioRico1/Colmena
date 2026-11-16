// The shared server (server/*.mjs) asks fetch for `redirect: "error"` (an API call must never be
// sent somewhere else with its keys). Node implements it; the Workers runtime refuses the value
// outright («Invalid redirect value…»), which broke connecting ChatGPT, OpenCode Go and every
// other provider in a hosted workspace. Here it becomes "manual" plus a refusal of any redirect,
// which is what Node does. Imported first by worker.js, before any module keeps a `fetch`.
const original = globalThis.fetch;

export function refuseRedirects(fetchImpl) {
  return async function fetch(input, init) {
    if (init?.redirect !== "error") return fetchImpl(input, init);
    const response = await fetchImpl(input, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400 && response.headers.has("Location")) {
      try { await response.body?.cancel(); } catch {}
      throw new TypeError("fetch failed: redirect refused (" + response.status + ")");
    }
    return response;
  };
}

globalThis.fetch = refuseRedirects(original.bind(globalThis));
