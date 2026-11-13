import Select from "../../Select.jsx";
import { useAction, useResource } from "../../../lib/store.jsx";
import { put } from "../../../lib/api.js";

// A bot's page › Apps que usa › «Navegador»: which browser session it opens (its own signed-in
// accounts, Ajustes › Navegador y dictado › Sesiones del navegador) and which saved passwords it
// may use to sign in without asking (the vault's accounts and the logins chosen from a password
// manager). It never sees any of them: Colmena types them in its browser.

export default function BotBrowser({ bot, subhead, row }) {
  const sessions = useResource("/browser-sessions");
  const vault = useResource("/vault");
  const logins = useResource("/logins");
  const grants = useResource("/sign-in-grants");
  const pick = useAction();
  const tick = useAction();
  const list = sessions.data?.sessions || [];
  const current = list.find((s) => s.bots.some((b) => b.id === bot.id))?.id || "principal";
  const accounts = [
    ...(vault.data?.entries || []).map((e) => ({ scope: "vault:" + e.id, site: e.domain, detail: [e.label !== e.domain ? e.label : null, e.username, "bóveda de Colmena"].filter(Boolean).join(" · ") })),
    ...(logins.data?.logins || []).map((l) => ({ scope: "login:" + l.id, site: l.domain, detail: [l.title !== l.domain ? l.title : null, l.username, l.managerLabel].filter(Boolean).join(" · ") })),
  ];
  const all = grants.data?.grants || {};
  const mine = new Set(Object.entries(all).filter(([, ids]) => ids.includes(bot.id)).map(([s]) => s));
  const toggle = (scope) => {
    const next = mine.has(scope) ? [...mine].filter((s) => s !== scope) : [...mine, scope];
    grants.setData((d) => {
      const g = { ...(d?.grants || {}) };
      const ids = new Set(g[scope] || []);
      if (mine.has(scope)) ids.delete(bot.id); else ids.add(bot.id);
      g[scope] = [...ids];
      return { grants: g };
    });
    tick.act(() => put(`/bots/${encodeURIComponent(bot.id)}/sign-ins`, { scopes: next }));
  };
  return (
    <>
      <span style={subhead}>{"Navegador"}</span>
      <div style={{ display: "flex", flexDirection: "column", marginTop: "-10px" }}>
        <div style={{ ...row, minHeight: "58px" }}>
          <span style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "1px" }}>
            <span style={{ fontSize: "var(--t-body)", fontWeight: "500" }}>{"Sesión del navegador"}</span>
            <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"Las cuentas que tiene abiertas al navegar. "}<a href="/ajustes/sistema#sesiones" style={{ color: "var(--c-accent-ink)" }}>{"Ver sesiones"}</a></span>
          </span>
          <Select label={`Sesión del navegador de ${bot.name}`} value={current} disabled={pick.busy || !list.length}
            options={list.map((s) => [s.id, s.name])}
            onChange={(e) => pick.act(async () => { await put(`/bots/${encodeURIComponent(bot.id)}/browser-session`, { session: e.target.value }); })}
            style={{ width: "240px", maxWidth: "100%", height: "40px", padding: "0 10px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-md)", background: "var(--c-card)", color: "var(--c-text)", fontSize: "var(--t-body)", boxSizing: "border-box" }} />
        </div>
        {pick.error ? <span role="alert" style={{ fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{pick.error}</span> : null}
        <div style={{ ...row, alignItems: "flex-start", flexDirection: "column", gap: "8px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            <span style={{ fontSize: "var(--t-body)", fontWeight: "500" }}>{"Contraseñas que puede usar"}</span>
            <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{`Entra con ellas sin verlas ni preguntarte. ${accounts.length ? "Las demás de la bóveda te las pide la primera vez." : ""}`}</span>
          </span>
          {accounts.length ? (
            <div role="group" aria-label={`Contraseñas que puede usar ${bot.name}`} style={{ alignSelf: "stretch", display: "flex", flexDirection: "column" }}>
              {accounts.map((a) => (
                <label key={a.scope} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "44px", cursor: tick.busy ? "wait" : "pointer" }}>
                  <input type="checkbox" checked={mine.has(a.scope)} disabled={tick.busy} onChange={() => toggle(a.scope)} style={{ width: "16px", height: "16px", accentColor: "var(--c-text)" }} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
                    <span style={{ fontSize: "var(--t-ui)", fontWeight: "500", overflowWrap: "anywhere" }}>{a.site}</span>
                    <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)", overflowWrap: "anywhere" }}>{a.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"No hay ninguna guardada. "}<a href="/ajustes/privacidad#gestores" style={{ color: "var(--c-accent-ink)" }}>{"Conecta tu gestor de contraseñas"}</a>{" o guarda una en la bóveda."}</span>
          )}
          {tick.error ? <span role="alert" style={{ fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{tick.error}</span> : null}
        </div>
      </div>
    </>
  );
}
