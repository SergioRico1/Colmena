import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe } from "lucide-react";
import { get } from "../../lib/api.js";

// Link hover previews (OpenClaw link-preview): resting on a link of an answer (<a data-preview>)
// for 250 ms, or reaching it with Tab, shows what the page is (site, title, description).
// Colmena reads the page itself, anonymously: nothing of yours is sent. Mounted once.
const DELAY = 250;
const cache = new Map(); // url → Promise<preview|null>

const load = (url) => {
  if (!cache.has(url)) {
    cache.set(url, get("/link-preview?url=" + encodeURIComponent(url)).then((r) => r.preview || null, () => null));
    if (cache.size > 64) cache.delete(cache.keys().next().value);
  }
  return cache.get(url);
};

export default function LinkPreviewLayer() {
  const [card, setCard] = useState(null); // {url, rect, preview, loading}
  const timer = useRef(0);
  const current = useRef(null);
  useEffect(() => {
    const show = (a) => {
      if (current.current === a) return;
      current.current = a;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const url = a.href;
        if (!/^https?:/i.test(url)) return;
        setCard({ url, rect: a.getBoundingClientRect(), preview: null, loading: true });
        load(url).then((preview) => {
          if (current.current !== a) return;
          setCard(preview ? { url, rect: a.getBoundingClientRect(), preview, loading: false } : null);
        });
      }, DELAY);
    };
    const hide = () => { clearTimeout(timer.current); current.current = null; setCard(null); };
    const over = (e) => { const a = e.target.closest?.("a[data-preview]"); if (a) show(a); else if (current.current) hide(); };
    const focus = (e) => { const a = e.target.closest?.("a[data-preview]"); if (a) show(a); };
    const key = (e) => { if (e.key === "Escape") hide(); };
    document.addEventListener("mouseover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("mouseover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);
  if (!card) return null;
  const width = 320;
  const below = card.rect.bottom + 180 < window.innerHeight;
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, card.rect.left));
  const p = card.preview;
  return createPortal(
    <div role="tooltip" className="c-pop"
      style={{ position: "fixed", zIndex: 60, left: left + "px", ...(below ? { top: card.rect.bottom + 8 + "px" } : { bottom: window.innerHeight - card.rect.top + 8 + "px" }), width: width + "px", padding: "12px 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "14px", boxShadow: "0 16px 36px -18px rgba(18,19,26,.45)", pointerEvents: "none", display: "flex", flexDirection: "column", gap: "4px" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#555A68", minWidth: 0 }}>
        <Globe size={13} strokeWidth={2} aria-hidden="true" style={{ flex: "none" }} />
        <span style={{ fontWeight: 600, color: "#2B2D36", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p?.site || new URL(card.url).hostname.replace(/^www\./, "")}</span>
        {p && p.site !== p.host ? <span style={{ font: "400 11px/1 'Geist Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.host}</span> : null}
      </span>
      {card.loading ? (
        <span style={{ fontSize: "13px", color: "#555A68" }}>{"Leyendo la página…"}</span>
      ) : (
        <>
          {p.title ? <strong style={{ fontSize: "14px", lineHeight: "1.35", display: "-webkit-box", WebkitLineClamp: "2", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.title}</strong> : null}
          {p.description ? <span style={{ fontSize: "13px", lineHeight: "1.45", color: "#2B2D36", display: "-webkit-box", WebkitLineClamp: "3", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.description}</span> : null}
        </>
      )}
    </div>,
    document.body,
  );
}
