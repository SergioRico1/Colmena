import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Password, Search, Trash2 } from "../../Icon.js";
import { BotChips } from "../../settings/SettingsShell.jsx";
import { useAction, useResource, useStore } from "../../../lib/store.jsx";
import { del, get, post, put } from "../../../lib/api.js";
import { Alert, Chip, LINE, btn, field } from "./v3.jsx";

// Ajustes › Memoria y privacidad › Contraseñas de webs › «Conectar un gestor de contraseñas»:
// 1Password (its CLI `op`, unlocked by the 1Password app) and Bitwarden (`bw`, unlocked in its
// own prompt). The person picks, site by site, which logins Colmena may use, and which bots may
// use each one (none by default). Colmena keeps only the site, the title and a masked user; the
// password is asked of the manager at the moment of signing in and goes straight to the bot's
// browser (server/managers). Nothing here ever shows or sends a password.

const TONE = { connected: "green", locked: "grey", setup: "grey", missing: "quiet" };
const CHIP = { connected: "Conectado", locked: "Bloqueado", setup: "Falta un paso", missing: "No instalado" };

/** Who may use one account: bot pills, none ticked by default. Shared with the vault's rows. */
export function AccountBots({ scope, label, asks = false }) {
  const { bots = [] } = useStore();
  const grants = useResource("/sign-in-grants");
  const { act, error } = useAction();
  const team = bots.filter((b) => b.enabled !== false);
  const selected = grants.data?.grants?.[scope] || [];
  const toggle = (botId) => {
    const next = selected.includes(botId) ? selected.filter((b) => b !== botId) : [...selected, botId];
    grants.setData((d) => ({ grants: { ...(d?.grants || {}), [scope]: next } }));
    act(() => put("/sign-in-grants", { scope, botIds: next }));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{selected.length ? "Pueden usarla sin preguntarte:" : asks ? "Cada bot te pide permiso la primera vez. Para que no pregunte, elígelo:" : "Ningún bot puede usarla todavía. Elige cuáles:"}</span>
      <BotChips bots={team} selected={selected} onToggle={toggle} label={label} />
      <Alert>{error}</Alert>
    </div>
  );
}

function Picker({ manager, onClose }) {
  const [items, setItems] = useState(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState(null);
  const { act, busy, error: actError } = useAction();
  const load = () => get(`/password-managers/${manager.id}/items`).then((d) => { setItems(d.items); setError(null); }, (e) => setError(e.message));
  useEffect(() => { load(); }, [manager.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items || []).filter((i) => !q || i.domain.includes(q) || i.title.toLowerCase().includes(q));
  }, [items, query]);
  const toggle = (item) => act(async () => {
    if (item.chosenId) await del(`/logins/${encodeURIComponent(item.chosenId)}`);
    else await post(`/password-managers/${manager.id}/logins`, { itemId: item.itemId });
    await load();
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--c-hover)", animation: "fade .2s ease-out" }}>
      <span style={{ fontSize: "var(--t-ui)", fontWeight: 600 }}>{`Qué inicios de sesión de ${manager.label} puede usar Colmena`}</span>
      <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.45, color: "var(--c-text-3)" }}>Marca solo los que tus bots necesiten. Colmena guarda la web y el nombre; la contraseña se la pide a {manager.label} cada vez que entra.</span>
      {error ? <Alert>{error}</Alert> : items === null ? <span role="status" style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{manager.id === "1password" ? "Abriendo 1Password… Si te pide desbloquearlo, hazlo en su ventana." : "Leyendo Bitwarden…"}</span> : (
        <>
          <label style={{ position: "relative", display: "flex" }}>
            <Search size={16} aria-hidden="true" style={{ position: "absolute", left: "10px", top: "10px", color: "var(--c-text-3)" }} />
            <input inputMode="search" enterKeyHint="search" autoComplete="off" type="search" aria-label="Buscar por web o nombre" placeholder="Buscar por web o nombre" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...field, width: "100%", paddingLeft: "34px" }} />
          </label>
          <div role="group" aria-label={`Inicios de sesión de ${manager.label}`} style={{ display: "flex", flexDirection: "column", maxHeight: "300px", overflowY: "auto", borderRadius: "var(--r-sm)", background: "var(--c-card)", border: "1px solid var(--c-line)" }}>
            {shown.map((item, i) => (
              <label key={item.itemId} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "48px", padding: "6px 14px", borderTop: i ? LINE : 0, cursor: busy ? "wait" : "pointer" }}>
                <input type="checkbox" checked={!!item.chosenId} disabled={busy} onChange={() => toggle(item)} style={{ width: "16px", height: "16px", accentColor: "var(--c-text)" }} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
                  <span style={{ fontSize: "var(--t-ui)", fontWeight: 500, overflowWrap: "anywhere" }}>{item.domain}</span>
                  <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)", overflowWrap: "anywhere" }}>{[item.title !== item.domain ? item.title : null, item.user].filter(Boolean).join(" · ")}</span>
                </span>
              </label>
            ))}
            {!shown.length ? <span style={{ padding: "14px", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{items.length ? "Ninguno coincide con la búsqueda." : `No hay inicios de sesión con una web en ${manager.label}.`}</span> : null}
          </div>
        </>
      )}
      <Alert>{actError}</Alert>
      <button type="button" onClick={onClose} style={{ ...btn("outline", 34), alignSelf: "flex-start" }}>Listo</button>
    </div>
  );
}

function ManagerRow({ m, first, onChanged, picking, setPicking }) {
  const { act, busy, error } = useAction();
  const usable = m.state === "connected" || (m.id === "1password" && m.state === "locked");
  const sentence = {
    missing: `Instala la herramienta de ${m.label} para la línea de comandos y vuelve aquí.`,
    setup: m.detail,
    locked: m.id === "1password" ? "Al elegir inicios de sesión, 1Password te pedirá desbloquearlo con tu huella, Windows Hello o tu contraseña, en su propia ventana." : m.canUnlock ? "Desbloquéalo en una ventana de Bitwarden: escribes tu contraseña maestra allí y Colmena no la ve." : "Desbloquéalo con «bw unlock» en tu terminal y abre Colmena desde ella.",
    connected: m.chosen ? `${m.chosen} ${m.chosen === 1 ? "inicio de sesión elegido" : "inicios de sesión elegidos"}.` : "Aún no has elegido ningún inicio de sesión.",
  }[m.state];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px 0", borderTop: first ? 0 : LINE }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 16px" }}>
        <span aria-hidden="true" style={{ width: "34px", height: "34px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: "var(--c-chip)", color: "var(--c-text-2)" }}><Password size={18} /></span>
        <span style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-body)", fontWeight: 600 }}>{m.label}<Chip tone={TONE[m.state]}>{m.state === "locked" && m.id === "1password" ? "Bloqueado — desbloquéalo en 1Password" : CHIP[m.state]}</Chip></span>
          <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.45, color: "var(--c-text-3)" }}>{sentence}</span>
        </span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {m.state === "missing" ? <button type="button" onClick={() => window.open(m.install, "_blank", "noopener")} style={btn("outline", 34)}><ExternalLink size={14} aria-hidden="true" />Cómo instalarlo</button> : null}
          {m.id === "bitwarden" && m.state === "locked" && m.canUnlock ? <button type="button" disabled={busy} onClick={() => act(async () => { await post("/password-managers/bitwarden/unlock"); onChanged(); })} style={btn("dark", 34)}>{busy ? "Esperando a Bitwarden…" : "Desbloquear"}</button> : null}
          {usable ? <button type="button" aria-expanded={picking} onClick={() => setPicking(picking ? null : m.id)} style={btn(!picking && m.state === "connected" && !m.chosen ? "dark" : "outline", 34)}>{picking ? "Ocultar" : "Elegir inicios de sesión"}</button> : null}
          {m.id === "bitwarden" && m.unlockedByColmena ? <button type="button" onClick={() => act(async () => { await post("/password-managers/bitwarden/lock"); onChanged(); })} style={btn("ghost", 34)}>Bloquear</button> : null}
        </span>
      </div>
      <Alert>{error}</Alert>
      {picking ? <Picker manager={m} onClose={() => { setPicking(null); onChanged(); }} /> : null}
    </div>
  );
}

function ChosenLogin({ login, first }) {
  const { act, busy } = useAction();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px 0", borderTop: first ? 0 : LINE }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
          <strong style={{ fontSize: "var(--t-ui)", fontWeight: 600, overflowWrap: "anywhere" }}>{login.domain}</strong>
          <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)", overflowWrap: "anywhere" }}>{[login.managerLabel, login.title !== login.domain ? login.title : null, login.username, login.uses ? `usada ${login.uses} ${login.uses === 1 ? "vez" : "veces"}` : "sin usar"].filter(Boolean).join(" · ")}</span>
        </span>
        <button type="button" disabled={busy} onClick={() => act(() => del(`/logins/${encodeURIComponent(login.id)}`))} aria-label={`Dejar de usar ${login.domain}`} title="Dejar de usarla" style={{ ...btn("ghost", 34), width: "34px", padding: 0 }}><Trash2 size={15} aria-hidden="true" /></button>
      </div>
      <AccountBots scope={"login:" + login.id} label={`Bots que pueden entrar en ${login.domain}`} />
    </div>
  );
}

export default function ManagersPanel() {
  const [managers, setManagers] = useState(null);
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(null);
  const logins = useResource("/logins");
  // Asking the programs takes a moment: on opening and after a change, never on every refresh.
  const refresh = () => get("/password-managers").then((d) => { setManagers(d.managers); setError(null); }, (e) => setError(e.message));
  useEffect(() => { refresh(); }, []);
  const chosen = logins.data?.logins || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "4px 12px 12px" }}>
      <p style={{ margin: "0 0 6px", fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-2)" }}>Tus bots entran con tus contraseñas sin verlas. Colmena se las pide a tu gestor en el momento de entrar, las escribe en el navegador del bot y no guarda ninguna.</p>
      <Alert>{error}</Alert>
      {managers === null && !error ? <span role="status" style={{ padding: "12px 0", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>Buscando gestores en este ordenador…</span> : null}
      {(managers || []).map((m, i) => <ManagerRow key={m.id} m={m} first={i === 0} picking={picking === m.id} setPicking={setPicking} onChanged={refresh} />)}
      {chosen.length ? (
        <section aria-labelledby="chosen-t" style={{ display: "flex", flexDirection: "column", marginTop: "8px", paddingTop: "12px", borderTop: LINE }}>
          <h4 id="chosen-t" style={{ margin: 0, fontSize: "var(--t-ui)", fontWeight: 600 }}>Inicios de sesión que puede usar Colmena</h4>
          {chosen.map((l, i) => <ChosenLogin key={l.id} login={l} first={i === 0} />)}
        </section>
      ) : null}
    </div>
  );
}
