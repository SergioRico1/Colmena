import { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main className="app">
      <h1>__TITLE__</h1>
      <p>Edita <code>src/App.jsx</code> y la vista previa se actualiza sola.</p>
      <button type="button" onClick={() => setCount((n) => n + 1)}>
        Pulsado {count} {count === 1 ? "vez" : "veces"}
      </button>
    </main>
  );
}
