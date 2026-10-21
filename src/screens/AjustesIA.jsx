import { useEffect, useRef, useState } from "react";
import SettingsShell, { BotAvatar, Notice, Toggle } from "../components/settings/SettingsShell.jsx";
import { css } from "../design/css/AjustesIA.js";
import { useStore, useAction } from "../lib/store.jsx";
import { patch, post } from "../lib/api.js";
import ProviderMark from "../components/v2/ProviderMark.jsx";

const CHIPS = {
  no: { label: "Sin conectar", bg: "#FFFFFF", fg: "#3D404A", border: "0", dot: "#A9AEBB" },
  wait: { label: "Esperando al navegador…", bg: "#FFF4D1", fg: "#12131A", border: "1px solid #F2D27A", dot: "#C98A00" },
  ok: { label: "Conectado", bg: "#E1F4EC", fg: "#0B5A3E", border: "1px solid #9ED4BC", dot: "#0B8A5F" },
  error: { label: "Error", bg: "#FDECEC", fg: "#8F1D22", border: "1px solid #F1B5B7", dot: "#E5484D" },
};
// Only the design CSS adds focus rings/animations; inputs of the inline forms get the same ring.
const EXTRA = "\ninput:focus-visible,select:focus-visible{outline:3px solid #2F6BFF;outline-offset:1px}";

const inputStyle = { height: "48px", padding: "0 16px", background: "#F4F4F0", border: "0", borderRadius: "14px", fontSize: "15px", outline: "none", minWidth: "0" };

export default function AjustesIA() {
  const { account, provider, authError, models, settings, bots, ready } = useStore();
  const { act, busy, error, setError } = useAction();
  const [waiting, setWaiting] = useState(null); // { url, code? } while the browser login is pending
  const [form, setForm] = useState(null); // 'apikey' | 'local' | null
  const [key, setKey] = useState("");
  const [local, setLocal] = useState({ baseUrl: "http://127.0.0.1:11434/v1", model: "" });
  const [note, setNote] = useState(null);
  const formRef = useRef(null);
  const connected = Boolean(account && account.connected !== false);
  const team = bots.filter((b) => b.enabled !== false);

  // The server reports the end of the OAuth flow over SSE (state refresh).
  useEffect(() => {
    if (connected || authError) setWaiting(null);
  }, [connected, authError]);
  useEffect(() => {
    if (form) formRef.current?.querySelector("input")?.focus();
  }, [form]);

  const conn = waiting ? "wait" : connected ? "ok" : authError ? "error" : "no";
  const chip = CHIPS[conn];

  const login = async () => {
    setNote(null);
    const result = await act(() => post("/auth/start"));
    if (!result?.url) return;
    window.open(result.url, "_blank", "noopener");
    setWaiting({ url: result.url, code: result.userCode || result.code || null });
  };
  const reopen = () => waiting?.url && window.open(waiting.url, "_blank", "noopener");
  const cancel = () => act(() => post("/auth/cancel")).then(() => setWaiting(null));
  const logout = () => act(() => post("/auth/logout"));
  const test = async () => {
    setNote(null);
    const list = await act(() => post("/auth/models"));
    if (Array.isArray(list)) setNote(`Conexión correcta · ${list.length} ${list.length === 1 ? "modelo disponible" : "modelos disponibles"}.`);
  };
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setNote("Copiado.");
    } catch {
      setError("No se pudo copiar. Selecciona el texto y cópialo a mano.");
    }
  };
  const saveKey = async (event) => {
    event.preventDefault();
    if (!key.trim()) return setError("Pega la clave antes de guardar.");
    const ok = await act(() => post("/auth/apikey", { key: key.trim() }));
    if (ok !== undefined) {
      setKey("");
      setForm(null);
      setNote("Clave guardada. Tus bots ya pueden usarla.");
    }
  };
  const saveLocal = async (event) => {
    event.preventDefault();
    if (!local.baseUrl.trim() || !local.model.trim()) return setError("Escribe la dirección y el nombre del modelo.");
    const ok = await act(() => post("/auth/local", { baseUrl: local.baseUrl.trim(), model: local.model.trim() }));
    if (ok !== undefined) {
      setForm(null);
      setNote("Modelo local guardado.");
    }
  };
  const openForm = (which) => {
    setError(null);
    setForm(which);
  };

  const usesCloud = (b) => b.usesChatGPT !== false;
  const usingCount = team.filter(usesCloud).length;
  const apiInUse = provider?.kind === "apikey";
  const localInUse = provider?.kind === "local";

  return (
    <SettingsShell section="ia" gap="24px" extraCss={css.replace(/^\*\{[^}]*\}\nbody\{[^}]*\}\n/, "") + EXTRA}>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "720px" }}>
        <h1 style={{ margin: "0", font: "600 36px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", letterSpacing: "-0.02em" }}>Cuentas de IA</h1>
        <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.5", color: "#5C606C" }}>El «cerebro» con el que piensan tus bots. Entra con una cuenta que ya tengas: Colmena recibe un permiso, nunca tu contraseña.</p>
      </div>
      {error || note ? <div style={{ maxWidth: "860px" }}><Notice tone={error ? "error" : "ok"}>{error || note}</Notice></div> : null}

      <section aria-labelledby="chatgpt-t" style={{ maxWidth: "860px", background: "#FFFFFF", border: "0", borderRadius: "20px", overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px", padding: "18px 22px", borderBottom: "1px solid rgba(18,19,26,.06)" }}>
          <span aria-hidden="true" style={{ width: "48px", height: "48px", flex: "none", display: "grid", placeItems: "center", background: "#12131A", color: "#FFFFFF", borderRadius: "12px" }}>
            <ProviderMark engine="openai" tile={false} size={24} light />
          </span>
          <div style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <h2 id="chatgpt-t" style={{ margin: "0", font: "600 22px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>ChatGPT</h2>
            <span style={{ fontSize: "14px", color: "#5C606C" }}>Usa tu suscripción de ChatGPT para que tus bots piensen con sus modelos.</span>
          </div>
          <span role="status" style={{ display: "flex", alignItems: "center", gap: "8px", height: "32px", padding: "0 12px", borderRadius: "16px", fontSize: "13px", fontWeight: "600", background: chip.bg, color: chip.fg, border: chip.border }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: chip.dot }} />
            {ready ? chip.label : "Comprobando…"}
          </span>
        </div>

        {conn === "no" || conn === "error" ? (
          <div style={{ padding: "24px 22px", display: "flex", flexWrap: "wrap", gap: "28px", animation: "rise .3s ease-out" }}>
            <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "16px" }}>
              {conn === "error" ? <Notice>{`No se pudo conectar: ${authError}`}</Notice> : null}
              <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "10px", fontSize: "15px", lineHeight: "1.45" }}>
                {["Tus bots usarán los modelos incluidos en tu plan.", "El uso cuenta en tu suscripción, con sus límites.", "Puedes desconectarlo aquí o desde tu cuenta cuando quieras."].map((t) => (
                  <li key={t} style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: "10px" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B6B4A" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginTop: "2px" }}><path d="m5 12 5 5 9-10" /></svg>
                    {t}
                  </li>
                ))}
              </ul>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-start" }}>
                <button type="button" onClick={login} disabled={busy} style={{ display: "flex", alignItems: "center", gap: "12px", height: "54px", padding: "0 26px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "16px", opacity: busy ? 0.7 : 1 }}>
                  {conn === "error" ? "Volver a intentarlo" : "Iniciar sesión con ChatGPT"}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" /></svg>
                </button>
                <span style={{ fontSize: "13px", color: "#5C606C" }}>Se abrirá la página oficial en tu navegador. Allí escribes tu contraseña, no aquí.</span>
                <button type="button" onClick={() => openForm("apikey")} style={{ padding: "0", minHeight: "32px", background: "transparent", border: "0", cursor: "pointer", fontSize: "14px", fontWeight: "600", color: "#1F4FD1", textDecoration: "underline" }}>Usar una clave de API en su lugar</button>
              </div>
            </div>
            <div style={{ flex: "1 1 240px", padding: "16px 18px", background: "#F6F6F3", borderRadius: "14px", display: "flex", flexDirection: "column", gap: "10px", alignSelf: "flex-start" }}>
              <strong style={{ fontSize: "14px" }}>Cómo funciona</strong>
              <ol style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "10px", fontSize: "14px", lineHeight: "1.4" }}>
                {["Inicias sesión en la página de ChatGPT.", "Das permiso a Colmena.", "Vuelves aquí y eliges qué bots la usan."].map((t, i) => (
                  <li key={t} style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: "8px" }}>
                    <span style={{ width: "22px", height: "22px", borderRadius: "50%", background: "#FFFFFF", border: "0", display: "grid", placeItems: "center", font: "600 11px/1 'Geist Mono', monospace" }}>{i + 1}</span>
                    {t}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : null}

        {conn === "wait" ? (
          <div style={{ padding: "28px 22px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "28px", animation: "rise .3s ease-out" }}>
            <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <span aria-hidden="true" style={{ width: "36px", height: "36px", flex: "none", borderRadius: "50%", border: "4px solid #F4F4F0", borderTopColor: "#12131A", animation: "spin .9s linear infinite" }} />
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <strong style={{ fontSize: "17px" }}>Esperando a que inicies sesión…</strong>
                  <span style={{ fontSize: "14px", color: "#5C606C" }}>Termina en tu navegador. Te esperamos aquí; no cierres esta ventana.</span>
                </div>
              </div>
              <ol style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "10px", fontSize: "14px" }}>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ width: "22px", height: "22px", borderRadius: "50%", background: "#12131A", color: "#FFFFFF", display: "grid", placeItems: "center" }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                  </span>
                  Página de inicio de sesión abierta
                </li>
                <li style={{ display: "flex", alignItems: "center", gap: "10px", fontWeight: "700" }}>
                  <span aria-hidden="true" style={{ width: "22px", height: "22px", borderRadius: "50%", border: "3px solid rgba(18,19,26,.1)", borderTopColor: "#12131A", animation: "spin .8s linear infinite" }} />
                  Esperando tu permiso
                </li>
                <li style={{ display: "flex", alignItems: "center", gap: "10px", color: "#5C606C" }}>
                  <span aria-hidden="true" style={{ width: "22px", height: "22px", borderRadius: "50%", border: "0" , background: "#FFFFFF"}} />
                  Elegir qué bots la usan
                </li>
              </ol>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <button type="button" onClick={reopen} style={{ height: "44px", padding: "0 16px", background: "rgba(18,19,26,.06)", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }}>Volver a abrir la página</button>
                <button type="button" onClick={cancel} disabled={busy} style={{ height: "44px", padding: "0 16px", background: "transparent", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "14px", color: "#5C606C" }}>Cancelar</button>
              </div>
            </div>
            <div style={{ flex: "1 1 240px", padding: "18px", background: "#F6F6F3", borderRadius: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <span style={{ fontSize: "14px" }}>{waiting.code ? "Si la página te pide un código, escribe este:" : "¿No se ha abierto la página? Copia este enlace en tu navegador:"}</span>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "12px 14px", background: "#FFFFFF", border: "0", borderRadius: "12px" }}>
                {waiting.code
                  ? <span style={{ font: "600 26px/1 'Geist Mono', monospace", letterSpacing: "0.12em" }}>{waiting.code}</span>
                  : <span style={{ font: "500 13px/1.3 'Geist Mono', monospace", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={waiting.url}>{waiting.url}</span>}
                <button type="button" aria-label={waiting.code ? "Copiar código" : "Copiar enlace"} onClick={() => copy(waiting.code || waiting.url)} style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "10px", cursor: "pointer" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>
                </button>
              </div>
              <span style={{ fontSize: "12px", color: "#5C606C" }}>Caduca en 5 minutos.</span>
            </div>
          </div>
        ) : null}

        {conn === "ok" ? (
          <div style={{ padding: "22px", display: "flex", flexDirection: "column", gap: "18px", animation: "rise .3s ease-out" }}>
            <div role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", padding: "14px 16px", background: "#E1F4EC", border: "1.5px solid #0B8A5F", borderRadius: "14px", fontSize: "15px" }}>
              <span aria-hidden="true" style={{ width: "26px", height: "26px", flex: "none", borderRadius: "50%", background: "#0B8A5F", color: "#FFFFFF", display: "grid", placeItems: "center" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
              </span>
              <span style={{ flex: "1 1 280px" }}>
                Conectado como <strong>{account.email || account.label || "tu cuenta"}</strong>
                {account.plan ? <>{" · plan "}<strong>{account.plan}</strong></> : null}
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px", fontSize: "14px" }}>
              <label htmlFor="modelo" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <strong style={{ fontSize: "16px" }}>Modelos</strong>
                <span style={{ fontSize: "13px", color: "#5C606C" }}>Colmena elige el de cada bot según su función, siempre en la versión más alta de tu plan.</span>
              </label>
              {models.length ? (
                <span style={{ font: "500 12px/1 'Geist Mono', monospace", color: "#5C606C" }}>{`${models.length} ${models.length === 1 ? "modelo disponible" : "modelos disponibles"}`}</span>
              ) : (
                <button type="button" onClick={test} disabled={busy} style={{ height: "40px", padding: "0 12px", background: "#FFFFFF", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: "600" }}>Cargar modelos</button>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "8px", paddingBottom: "8px" }}>
                <strong style={{ fontSize: "16px" }}>Qué bots piensan con ChatGPT</strong>
                <span style={{ fontSize: "13px", color: "#5C606C" }}>{usingCount}{` de ${team.length}`}</span>
              </div>
              {team.map((b) => {
                const on = usesCloud(b);
                return (
                  <div key={b.id} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "54px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
                    <BotAvatar bot={b} size={30} font={13} />
                    <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px" }}>
                      <strong style={{ fontSize: "15px" }}>{b.name}</strong>
                      <span style={{ fontSize: "12px", color: "#5C606C" }}>{on ? (b.model?.label ? `Piensa con ${b.model.label} · ${b.model.reason}` : "Usa ChatGPT") : "Usa el modelo de este ordenador"}</span>
                    </span>
                    <Toggle large on={on} disabled={busy} label={`${b.name} usa ChatGPT`} onChange={(v) => act(() => patch(`/bots/${encodeURIComponent(b.id)}`, { usesChatGPT: v }))} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", paddingTop: "4px" }}>
              <button type="button" onClick={test} disabled={busy} style={{ height: "44px", padding: "0 16px", background: "rgba(18,19,26,.06)", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }}>Probar conexión</button>
              <button type="button" onClick={logout} disabled={busy} style={{ height: "44px", padding: "0 16px", background: "transparent", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "14px" }}>Cerrar sesión</button>
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="otras-t" style={{ maxWidth: "860px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 id="otras-t" style={{ margin: "0", font: "600 20px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Otras cuentas</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: "12px" }}>
                    <div style={{ padding: "16px", background: "#FFFFFF", border: "0", boxShadow: localInUse ? "0 0 0 2px #0B8A5F" : "none", borderRadius: "26px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <span aria-hidden="true" style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: "#F4F4F0", borderRadius: "10px" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
            </span>
            <strong style={{ fontSize: "15px" }}>Modelo en este ordenador</strong>
            {localInUse
              ? <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#0B6B4A", fontWeight: "600" }}><span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#0B8A5F" }} />{`En uso${provider.label ? ` · ${provider.label}` : ""}`}</span>
              : <span style={{ fontSize: "13px", color: "#5C606C" }}>Sin conexión a internet; más lento</span>}
            <button type="button" aria-expanded={form === "local"} onClick={() => openForm(form === "local" ? null : "local")} style={{ alignSelf: "flex-start", height: "38px", padding: "0 16px", background: "rgba(18,19,26,.06)", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>Configurar</button>
          </div>
          <div style={{ padding: "16px", background: "#FFFFFF", border: "0", boxShadow: apiInUse ? "0 0 0 2px #0B8A5F" : "none", borderRadius: "26px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <span aria-hidden="true" style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: "#F4F4F0", borderRadius: "10px" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="8" cy="12" r="4" /><path d="M12 12h9M18 12v3M21 12v2" /></svg>
            </span>
            <strong style={{ fontSize: "15px" }}>Clave de API</strong>
            {apiInUse
              ? <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#0B6B4A", fontWeight: "600" }}><span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#0B8A5F" }} />{`En uso${provider.label ? ` · ${provider.label}` : ""}`}</span>
              : <span style={{ fontSize: "13px", color: "#5C606C" }}>Para equipos técnicos</span>}
            <button type="button" aria-expanded={form === "apikey"} onClick={() => openForm(form === "apikey" ? null : "apikey")} style={{ alignSelf: "flex-start", height: "38px", padding: "0 16px", background: "rgba(18,19,26,.06)", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>{apiInUse ? "Cambiar clave" : "Añadir clave"}</button>
          </div>

          {form === "apikey" ? (
            <form ref={formRef} onSubmit={saveKey} aria-labelledby="apikey-t" style={{ gridColumn: "1 / -1", padding: "18px 20px", background: "#FFFFFF", border: "0", borderRadius: "26px", display: "flex", flexDirection: "column", gap: "12px", animation: "rise .3s ease-out" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <h3 id="apikey-t" style={{ margin: "0", font: "600 18px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Usar una clave de API</h3>
                <span style={{ fontSize: "13px", lineHeight: "1.45", color: "#5C606C" }}>Pega la clave de tu cuenta de OpenAI. Se guarda cifrada en este ordenador y no vuelve a mostrarse.</span>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", color: "#5C606C" }}>
                Clave
                <input type="password" autoComplete="off" spellCheck="false" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" style={{ ...inputStyle, fontFamily: "'Geist Mono', monospace", fontSize: "14px", color: "#12131A" }} />
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <button type="submit" disabled={busy} style={{ height: "44px", padding: "0 18px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }}>{busy ? "Guardando…" : "Guardar"}</button>
                <button type="button" onClick={() => setForm(null)} style={{ height: "44px", padding: "0 16px", background: "transparent", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "14px", color: "#5C606C" }}>Cancelar</button>
              </div>
            </form>
          ) : null}
          {form === "local" ? (
            <form ref={formRef} onSubmit={saveLocal} aria-labelledby="local-t" style={{ gridColumn: "1 / -1", padding: "18px 20px", background: "#FFFFFF", border: "0", borderRadius: "26px", display: "flex", flexDirection: "column", gap: "12px", animation: "rise .3s ease-out" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <h3 id="local-t" style={{ margin: "0", font: "600 18px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Modelo en este ordenador</h3>
                <span style={{ fontSize: "13px", lineHeight: "1.45", color: "#5C606C" }}>Funciona con programas como Ollama o LM Studio que ya tengas abiertos. Nada sale de este ordenador.</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                <label style={{ flex: "2 1 260px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", color: "#5C606C" }}>
                  Dirección
                  <input type="url" value={local.baseUrl} onChange={(e) => setLocal({ ...local, baseUrl: e.target.value })} style={{ ...inputStyle, fontFamily: "'Geist Mono', monospace", fontSize: "14px", color: "#12131A" }} />
                </label>
                <label style={{ flex: "1 1 180px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", color: "#5C606C" }}>
                  Modelo
                  <input type="text" value={local.model} onChange={(e) => setLocal({ ...local, model: e.target.value })} placeholder="llama3.1" style={{ ...inputStyle, fontFamily: "'Geist Mono', monospace", fontSize: "14px", color: "#12131A" }} />
                </label>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <button type="submit" disabled={busy} style={{ height: "44px", padding: "0 18px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }}>{busy ? "Guardando…" : "Guardar"}</button>
                <button type="button" onClick={() => setForm(null)} style={{ height: "44px", padding: "0 16px", background: "transparent", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "14px", color: "#5C606C" }}>Cancelar</button>
              </div>
            </form>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="privacidad-t" style={{ maxWidth: "860px", padding: "18px 20px", background: "#FFFFFF", border: "0", borderRadius: "26px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <h2 id="privacidad-t" style={{ margin: "0", display: "flex", alignItems: "center", gap: "8px", font: "600 18px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" /></svg>
          Qué compartes al conectar
        </h2>
        <ul style={{ margin: "0", paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", lineHeight: "1.5", color: "#3D404A" }}>
          <li>Colmena recibe un permiso de uso, nunca tu contraseña.</li>
          <li>Solo se envía lo que cada bot necesita para su tarea.</li>
          <li>Puedes revocar el permiso aquí o desde la configuración de tu cuenta.</li>
        </ul>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px", paddingTop: "10px", borderTop: "1px solid rgba(18,19,26,.06)", fontSize: "14px" }}>
          <label htmlFor="fallback">Si una cuenta falla, usar</label>
          <select id="fallback" value={settings.fallback || "none"} disabled={busy} onChange={(e) => act(() => patch("/settings", { fallback: e.target.value }))} style={{ height: "40px", padding: "0 12px", background: "#FFFFFF", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: "600" }}>
            <option value="local">Modelo en este ordenador</option>
            <option value="none">Ninguna: parar y avisarme</option>
          </select>
        </div>
      </section>
    </SettingsShell>
  );
}
