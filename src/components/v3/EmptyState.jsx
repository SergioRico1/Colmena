import { navigate } from "../../lib/router.jsx";

// Colmena 3 · «Vacío» (design/V3Estados.dc.html): three quiet grey shapes, what will appear
// here and how to get it, and one way forward. Never a screen without a way out.
//   <EmptyState title="Aún no hay tareas" text="Cuando pidas algo…" action={{ label: "Pedir algo", href: "/" }} />
// `action` takes href (an app address) or onClick; `secondary` is an optional quieter second
// way. `surface` draws the white card around it (for a list area on the paper background).

const INK = "#12131A";

function Action({ action, dark }) {
  if (!action?.label) return null;
  const style = dark
    ? { height: "42px", padding: "0 18px", display: "inline-flex", alignItems: "center", border: "0", borderRadius: "999px", background: INK, color: "#FFFFFF", fontSize: "14px", fontWeight: "600", cursor: "pointer", textDecoration: "none" }
    : { height: "42px", padding: "0 16px", display: "inline-flex", alignItems: "center", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "transparent", color: INK, fontSize: "14px", fontWeight: "500", cursor: "pointer", textDecoration: "none" };
  if (action.href) {
    const external = /^https?:/.test(action.href);
    return (
      <a href={action.href} onClick={external ? undefined : (e) => { e.preventDefault(); action.onClick?.(); navigate(action.href); }} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} style={style}>
        {action.label}
      </a>
    );
  }
  return <button type="button" disabled={action.disabled} onClick={action.onClick} style={style}>{action.label}</button>;
}

export default function EmptyState({ title, text = null, action = null, secondary = null, surface = false, height = null, style = null }) {
  return (
    <div role="status" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px", padding: "28px", textAlign: "center", ...(surface ? { borderRadius: "24px", background: "#FFFFFF" } : {}), ...(height ? { minHeight: typeof height === "number" ? height + "px" : height } : {}), ...style }}>
      <span aria-hidden="true" style={{ display: "flex", gap: "6px" }}>
        <span style={{ width: "18px", height: "18px", background: "#E6E7EC", borderRadius: "24%" }} />
        <span style={{ width: "18px", height: "18px", background: "#E6E7EC", borderRadius: "50%" }} />
        <span style={{ width: "18px", height: "18px", background: "#E6E7EC", clipPath: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" }} />
      </span>
      <span style={{ font: "600 22px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", color: INK }}>{title}</span>
      {text ? <span style={{ fontSize: "14px", lineHeight: "1.5", color: "#4A4D57", maxWidth: "320px" }}>{text}</span> : null}
      {action || secondary ? (
        <span style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "10px" }}>
          <Action action={action} dark />
          <Action action={secondary} dark={false} />
        </span>
      ) : null}
    </div>
  );
}
