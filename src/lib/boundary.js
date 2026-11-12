import { Component } from "react";

// What the crash guards share (components/ErrorBoundary.jsx for the whole app,
// components/RowBoundary.jsx for one message or card): a boundary that shows a fallback
// instead of what threw, and one line in the console per error — never two, whoever sees
// it first (the boundary, or React through `onCaughtError`, src/main.jsx).

const CHUNK = /dynamically imported module|module script failed|ChunkLoadError|Loading (?:CSS )?chunk|Unable to preload CSS/i;
/** A screen's code could not be loaded (after an update the old files are gone): reloading fixes it. */
export const isChunkError = (error) => CHUNK.test(String(error?.name || "") + " " + String(error?.message || error || ""));

/** What the crash screen's detail shows and copies: the error, and where it broke. */
export function errorText(error, componentStack = "") {
  const head = String(error?.stack || error?.message || error || "Error desconocido");
  const where = String(componentStack || "").trim();
  return (head + (where ? "\n\nEn:\n" + where : "")).slice(0, 8000);
}

const logged = new WeakSet();
/** Writes the error to the console the first time it is seen; true when it did. */
export function logOnce(error, label = "Algo ha fallado al mostrar la pantalla", componentStack = "") {
  const tracked = error && (typeof error === "object" || typeof error === "function");
  if (tracked && logged.has(error)) return false;
  if (tracked) logged.add(error);
  console.error("[Colmena] " + label + ":", error, componentStack || "");
  return true;
}
/**
 * For `createRoot(…, { onCaughtError })`, instead of React's own report. React tells the
 * root before the boundary: this waits a moment so the boundary's line, which names what
 * failed, is the one written; an error no boundary of ours logged is written here.
 */
export const logCaught = (error, info) => { queueMicrotask(() => logOnce(error, undefined, info?.componentStack)); };

/**
 * Shows `fallback(error, componentStack)` instead of its children once one of them throws
 * while rendering. `resetKey`: when it changes, the children are tried again (a row whose
 * record changed). `label` names it in the console.
 */
export class Boundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, componentStack: "", resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error: error ?? Error("Error desconocido") };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey === state.resetKey) return null;
    return { error: null, componentStack: "", resetKey: props.resetKey };
  }

  componentDidCatch(error, info) {
    logOnce(error, this.props.label, info?.componentStack);
    if (this.props.keepStack) this.setState({ componentStack: info?.componentStack || "" });
  }

  render() {
    if (this.state.error == null) return this.props.children;
    return this.props.fallback(this.state.error, this.state.componentStack);
  }
}
