// The frame of the hosted pages: the wordmark, one column, a quiet foot.
import Logo from "../components/Logo.jsx";

export function Shell({ children, wide = false, right = null }) {
  return (
    <div className="cl-shell">
      <header className="cl-top">
        <a href="/" aria-label="Colmena, inicio" style={{ textDecoration: "none" }}><Logo size={28} fontSize={20} tone="dark" gap={9} /></a>
        {right}
      </header>
      <main className={"cl-main" + (wide ? " wide" : "")}>{children}</main>
      <footer className="cl-foot">Colmena · tus datos se guardan cifrados en la Unión Europea</footer>
    </div>
  );
}
