import { useLayoutEffect } from "react";
import { css } from "../../design/V2Hoy.jsx";
import Rail from "./Rail.jsx";

// Every Colmena 2.0 place: the rail on the left (never moves) and the content beside it,
// which is the only thing that scrolls. The window as a whole never scrolls. In the desktop
// app an invisible strip along the top lets you drag the window (the rail drags too).
export default function Shell({ active, children, background = "#F5F5F2", scroll = true, extraCss = null }) {
  useLayoutEffect(() => {
    document.documentElement.dataset.v2 = "1";
    return () => { delete document.documentElement.dataset.v2; };
  }, []);
  const desktop = typeof window !== "undefined" && !!window.colmenaWindow;
  return (
    <>
      <style>{css}</style>
      {extraCss ? <style>{extraCss}</style> : null}
      <div style={{ position: "relative", display: "flex", height: "100vh", overflow: "hidden", background }}>
        <Rail active={active} />
        <div data-v2-content="" style={{ position: "relative", flex: "1", minWidth: "0", height: "100%", overflowY: scroll ? "auto" : "hidden", overscrollBehavior: "contain" }}>
          {children}
        </div>
        {desktop ? <div aria-hidden="true" style={{ position: "fixed", top: 0, left: "84px", right: 0, height: "22px", zIndex: 30, WebkitAppRegion: "drag" }} /> : null}
      </div>
    </>
  );
}
