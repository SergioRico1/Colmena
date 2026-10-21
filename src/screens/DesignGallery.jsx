import { Suspense, lazy, useMemo } from "react";

// QA aid: renders the untouched generated design next to the live route.
const designs = import.meta.env.DEV ? import.meta.glob("../design/*.jsx") : {};
const names = Object.keys(designs).map((p) => p.match(/([^/]+)\.jsx$/)[1]).sort();

export default function DesignGallery({ params }) {
  const name = params.name;
  const Design = useMemo(() => (name && designs[`../design/${name}.jsx`] ? lazy(designs[`../design/${name}.jsx`]) : null), [name]);
  if (Design) return <Suspense fallback={null}><Design /></Suspense>;
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <h1 style={{ margin: 0, font: "800 40px/1 'Bricolage Grotesque', sans-serif" }}>Diseños originales</h1>
      <p style={{ margin: 0, color: "#4A4F5C" }}>Maquetas aprobadas convertidas sin cambios, para comparar con la aplicación.</p>
      {names.map((n) => <a key={n} href={`/_design/${n}`} style={{ padding: "12px 16px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: 12, fontWeight: 600 }}>{n}</a>)}
    </main>
  );
}
