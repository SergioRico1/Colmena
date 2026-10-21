import { useCallback, useRef, useState } from "react";
import { readFiles } from "./api.js";

export const PASTE_CARD_AT = 1000;
/** A paste this big (T3 Code composerAttachmentFiles) is a file, not text: it goes attached. */
export const PASTE_FILE_AT = 32 * 1024;
/** The longest text a message can carry (server: POST /missions/:id/messages). */
export const MESSAGE_MAX = 20000;
const TEXT_ATTACHMENT_MAX = 200000; // server/files.mjs ATTACHMENT_LIMITS.textChars

const pastedName = () => `pegado-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;

/** A long pasted text as an attachment: «pegado-2026-10-17-09-12-03.txt». */
export function pastedText(text) {
  return { name: pastedName(), content: text, size: new Blob([text]).size, encoding: "utf8", pasted: true };
}

/** A very long paste as a plain text file (base64 beyond what a text attachment carries). */
export function pastedFile(text) {
  const bytes = new TextEncoder().encode(text);
  if (text.length <= TEXT_ATTACHMENT_MAX) return { name: pastedName(), content: text, size: bytes.length, encoding: "utf8" };
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name: pastedName(), content: btoa(binary), size: bytes.length, encoding: "base64" };
}

/** What a paste of `text` becomes: a file (≥ 32 KB), a card (long), or plain text (null). */
export function pasteKind(text, { pasteCards = false } = {}) {
  const value = String(text || "");
  if (new Blob([value]).size >= PASTE_FILE_AT) return "file";
  if (pasteCards && value.length >= PASTE_CARD_AT) return "card";
  return null;
}

const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");

/**
 * Drop files on a composer, or paste them (a screenshot with Ctrl+V), to attach them.
 * `add(files)` receives attachments as pickFiles returns them; `onError(message)` the reason
 * a file was refused. Spread `props` on the drop area; `dragging` lights it up.
 */
export function useFileDrop(add, onError, { pasteCards = false } = {}) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const take = useCallback(async (list) => {
    if (!list.length) return;
    try {
      add(await readFiles(list));
    } catch (e) {
      onError?.(e.message);
    }
  }, [add, onError]);
  const props = {
    onDragEnter: (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setDragging(true); },
    onDragOver: (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
    onDragLeave: (e) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setDragging(false);
      take([...e.dataTransfer.files]);
    },
    onPaste: (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (!files.length) {
        // A long paste (OpenClaw pasted-text cards) becomes a card instead of flooding the box:
        // it is sent as a text file, and «Ponerlo en el texto» brings it back inline.
        // Past 32 KB it is a file whatever the composer (no message carries that much text).
        const plain = e.clipboardData?.getData("text/plain") || "";
        const kind = pasteKind(plain, { pasteCards });
        if (!kind) return; // plain text pastes as usual
        e.preventDefault();
        add([kind === "file" ? pastedFile(plain) : pastedText(plain)]);
        return;
      }
      e.preventDefault();
      take(files);
    },
  };
  return { dragging, props };
}

/** Honey dashed frame shown over a composer while files are dragged onto it. */
export const dropOverlay = {
  animation: "c-fade 140ms ease both",
  position: "absolute", inset: "0", zIndex: 5, display: "grid", placeItems: "center", borderRadius: "inherit",
  background: "rgba(255, 244, 209, 0.92)", border: "2px dashed #12131A", pointerEvents: "none",
  font: "700 15px/1.2 'Geist', sans-serif", color: "#12131A",
};
