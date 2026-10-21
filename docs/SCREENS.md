# Cómo se construye una pantalla de Colmena

## Fidelidad (regla nº 1)
Las maquetas aprobadas están en `design/<Pantalla>.dc.html` y se convierten sin cambios a
`src/design/<Pantalla>.jsx` (`npm run design`; NO editar esos archivos). Se ven en
`/_design/<Pantalla>`. La pantalla real `src/screens/<Pantalla>.jsx` debe verse **igual**:

1. Copia el `View` de `src/design/<Pantalla>.jsx` a `src/screens/<Pantalla>.jsx` como punto de partida.
   Conserva cada elemento, estilo inline, texto fijo, icono SVG, tamaño, color y orden.
2. Sustituye el `<nav aria-label="Navegación principal">…</nav>` por
   `<Sidebar variant="home|compact|profile" active="…" activeRoom={id} activeBot={id} />`
   (`src/components/Sidebar.jsx`). Variante: `home` solo en Inicio; `profile` en Perfil del bot; el resto `compact`.
3. Inyecta el CSS de la maqueta: `import { css } from "../design/<Pantalla>.jsx";` y `<style>{css}</style>` al principio.
4. Reemplaza el contenido de ejemplo (Nora, «informe-q3», cifras…) por datos reales del store/API.
   Las listas pasan a `.map()` reutilizando EXACTAMENTE el marcado del primer elemento de ejemplo.
   Variantes de estado (activo, te espera, hecho…) copian los estilos que la maqueta usa para ese estado.
5. Interacciones que la maqueta ya simula en su clase `Logic` (pestañas, selects, toggles…) se
   reimplementan con `useState` manteniendo los mismos estilos calculados.
6. Prohibido: datos inventados, botones muertos, desactivar botones «pendiente de diseño», cambiar
   textos de la interfaz salvo para meter datos reales. Si un dato aún no existe → estado vacío con el
   mismo estilo de la maqueta y una frase corta y útil (p. ej. «Nada te espera. Todo sigue su curso.»).
7. Si algo de la maqueta no tiene backend en `docs/CONTRACT.md`, se cablea igualmente al endpoint
   del contrato (el backend lo está implementando). Si de verdad no hay forma, abre un diálogo/estado
   diseñado con el mismo lenguaje visual que explique lo que falta (nunca un `alert`).
8. Responsive: la maqueta ya usa flex-wrap/clamp; no añadas anchos fijos.
9. Enlaces: usa `<a href="/ruta">` (el router los intercepta). Rutas en `src/routes.jsx`.
10. Accesible: botones reales, `aria-label` en iconos, foco visible.

## Piezas disponibles
- `useStore()` (`src/lib/store.jsx`): `{ bots, missions, approvals, automations, suggestions, skills, memories, artifacts, folders, people, connectors, settings, account, usage, paused, live, activity, ready, run, refresh }`.
  `live[stepId] = { text, botId, mission }` (texto en directo); `activity[botId] = { verb, detail, mission }`.
- `useResource('/missions/' + id)` → `{ data, error, loading }` (se refresca solo con SSE).
- `useAction()` → `{ act, busy, error }`; `act(() => post('/x', body))` refresca el estado al terminar.
- `api/get/post/patch/del`, `pickTextFiles()`, `download()` (`src/lib/api.js`).
- `navigate(path)`, `useRouter()` (`src/lib/router.jsx`). Props de pantalla: `{ params, query }`.
- `avatarStyle(bot, size)`, `initial(bot)` (`src/lib/bots.js`) — forma+color de cada bot.
- `roomUrl(m)`, `time`, `ago`, `shortDate`, `dateTime`, `greeting`, `todayLabel`, `words` (`src/lib/format.js`).

## Comprobación
- `npx vite build` sin errores.
- Compara visualmente `/_design/<Pantalla>` con la ruta real a 1440 px (el servidor de desarrollo
  ya está en http://localhost:4318; no arranques otro en ese puerto).
