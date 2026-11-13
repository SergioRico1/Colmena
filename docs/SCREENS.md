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
- Un bot se dibuja con `<BotFace>` (ver «v4» abajo); `avatarStyle(bot, size)` de `src/lib/bots.js` queda solo para recortar algo a la forma de un bot.
- `roomUrl(m)`, `time`, `ago`, `shortDate`, `dateTime`, `greeting`, `todayLabel`, `words` (`src/lib/format.js`).

- Tamaños de letra: una sola escala, `var(--t-micro|caption|meta|ui|body|read|lead|title|heading|headline|display-s|m|l|xl)`
  (`src/styles/base.css`; en números, `TYPE` y `stepOf(n)` de `src/lib/type.js`). Nada por debajo de 11 px ni medios píxeles.
- Esquinas: `var(--r-xs|sm|md|lg|xl|2xl|3xl|pill|circle)` (4, 8, 12, 16, 20, 24, 32; `src/lib/radius.js`). Las formas de los bots no son esquinas.
- `<Select label value onChange options />` (`src/components/Select.jsx`) en lugar de `<select>`; menús y paneles que se cierran
  al pulsar fuera usan `useClickAway` (`src/lib/useClickAway.js`).
- Conversaciones: `<Announcer text={useAnnouncer({ scope, ready, items, waiting })} />` (una sola zona `aria-live`), la lista de
  mensajes con `messageListProps()` y `leaveComposer(e)` en el Escape del cuadro de texto (`src/lib/messageKeys.js`).
- Un control de menos de 24 px de alto que no sea solo texto lleva `className="c-hit"`; un avatar de bot sin nombre al lado,
  `botAlt()`/`botsAlt()` de `src/lib/alt.js`.

## v4: tema, iconos y bots (base de Colmena 4)
Referencia visual: `design/v4/colmena-v4.html` (y sus capturas `design/v4/proto-*.png`). Todo lo nuevo se construye
con estas tres piezas; no hay colores, iconos ni bots dibujados a mano.

### Colores: tokens en claro y oscuro
- Definidos en `src/styles/base.css` sobre `:root` (claro) y `[data-theme="dark"]`. En estilos inline se usan por
  nombre desde `src/lib/theme.js`: `import { C, alpha, line } from "../lib/theme.js"` →
  `style={{ background: C.card, color: C.text, border: line() }}`. Nunca un hex de superficie, texto o borde.
  - Superficies: `app` (fondo de la ventana en v4), `sidebar`, `sidebarHover`, `selected` (fila activa), `panel`, `card`,
    `raised` (menús, diálogos), `sunken`, `hover`, `chip`, `mine` (tus mensajes) y `page` (el papel #F5F5F2 de las
    pantallas de Colmena 3, cuyas tarjetas blancas no llevan borde; las pantallas que se rehagan en v4 usan `app`).
  - Texto: `text` (tinta), `text2` (cuerpo), `text3` (secundario, 4,5:1), `text4` (el más tenue, 4,5:1), `onAccent`.
  - Líneas: `line`, `lineStrong`; trazos finos sobre cualquier fondo con `alpha(.08)` (= `rgb(var(--c-ink-rgb) / .08)`).
  - Acento y foco: `accent`, `accentInk` (enlaces), `accentSoft`, `focus`.
  - Miel, solo «te necesita»: `honey` (chip, contador), `honeyInk` (texto sobre miel), `honeyRing`, `honeySoft` (fondo de
    la tarjeta: ámbar apagado en oscuro, sin brillo), `honeyText`.
  - No leído (neutro): `unreadBg`, `unreadFg`. Estados: `ok`, `okInk`, `okSoft`, `error`, `errorSoft`.
  - Botón principal de tinta: `btn`, `btnText`, `btnHover` (claro sobre oscuro en tema oscuro). Sombras: `shadowPop`, `shadowLift`.
  - Recortes: `cut` (el aro que separa una chapa de su fondo).
- No concatenes transparencia a un token (`${C.text}22` no funciona): usa `alpha()` o `color-mix()`.
- Las hojas de estilo de los tableros (`css` de `src/design/*.jsx`) pintan el `body` en tinta y papel; con el tema
  puesto, `base.css` las sobrescribe.
- Lo que aún queda en hex por pantalla lo terminan los agentes que rehacen cada pantalla (codemod de colores: solo
  se cambió lo inequívoco).

- Más allá de los tokens base, `src/styles/palette.css` (en claro y oscuro) y sus nombres en `src/lib/palette4.js`:
  la terminal (`TERM`, `term-*`, y `ansi-*` que lee xterm con `xtermTheme()`/`watchXtermTheme()`: terminal de papel en
  claro, más honda que la ventana en oscuro), los tipos de archivo (`KIND.doc|xls|ppt|img|pdf|md|code` → [fondo, tinta,
  marca]), «a medias» (`WARN`, naranja que nunca es miel), la página de una vista previa (`PAPER`) y el avatar de una
  persona (`personTint(color)`: su color mezclado con la superficie, `--c-av-*`).
- Piezas de pantalla v4 (`src/lib/ui4.js`): botones `B.primary|secondary|ghost|danger` (32 px, `B.lg` 36 px, esquina
  `r-sm`), `CARD` (línea fina, `r-md`, sin sombra), `ROW`/`ROW_SEP`, `H1`/`LEAD`, `SEC`/`H2`/`COUNT`/`MORE`, `SIDE_H`,
  `TAG`, `chip(on)`, `WAIT_COUNT` (la cuenta en miel), `TRACK`/`fill(pct)` y `ONE`. Sus estados `:hover` son clases de
  `palette.css`: `u4-pri`, `u4-sec`, `u4-ghost`, `u4-row` y `u4-honey` (una fila sobre el fondo de miel).
- Las pantallas rehechas en v4 pasan `background="var(--c-app)"` a `<Shell>` y sus tarjetas llevan línea fina.
- `node scripts/a11y-scan.mjs <url> --dark` y `node scripts/v3-shot.cjs … --dark` miran el tema oscuro.

### Tema (Sistema / Claro / Oscuro)
- `settings.theme`: `"system"` (por defecto, sigue `prefers-color-scheme`), `"light"` o `"dark"`; se cambia en
  Ajustes › General › Tema (`/ajustes/general#tema`).
- `public/theme-boot.js` pone `<html data-theme>` antes del primer pintado con la última elección (copiada en
  `localStorage`); `watchTheme()` (`src/lib/theme.js`, llamado en `src/main.jsx`) la sigue después.
- Escritorio: `window.colmenaWindow.setTheme(mode)` (preload) fija el `backgroundColor` de la ventana y el
  `nativeTheme`; `desktop/main.cjs` lo guarda en `userData/theme.json` para el siguiente arranque.

### Iconos: Phosphor
- Un solo adaptador: `src/components/Icon.js`. Importa por nombre (`import { Search, House } from "../Icon.js"`),
  nunca `import *` ni rutas de SVG a mano. Peso `regular` por defecto; `active` (peso `fill`) para el sitio activo,
  la pestaña elegida o un control activado; `strokeWidth >= 2.4` o `weight="bold"` para un trazo más grueso.
- Escala: `ICON.sm` 16 (filas densas, chips), `ICON.md` 20 (sitios, barras), `ICON.lg` 24 (cabeceras).
- Decorativos (`aria-hidden`) salvo que lleven `aria-label` o `title`; el nombre lo lleva el botón que los contiene.
- Un icono nuevo: añade su línea en `Icon.js` (`icon(G.<NombrePhosphor>, "Nombre")`) y ejecuta
  `node scripts/gen-icons.mjs`, que copia sus trazos regular y fill de `@phosphor-icons/react` (fijado) a
  `src/components/icons.gen.js`. `node scripts/gen-icons.mjs --check` avisa si está desfasado.
- Fuera de esta regla: logotipos de proveedores (`ProviderMark`), gráficos y el lienzo de diseño (`src/design`).

### Bots: `<BotFace>`
- `src/components/BotFace.jsx` (generador puro en `src/lib/pixelBot.js`): `<BotFace bot={bot} size={32} />`.
  Tamaños 20 · 24 · 32 · 48 · 96 (cualquiera funciona; esos son píxeles enteros por celda).
- Forma por papel (`hex` Coordinador, `capsule` Investigación, `square` Datos, `diamond` Diseño, `leaf` Redacción,
  `arch` Código), color propio (tono de la familia de su persona, `server/bot-looks.mjs`), un accesorio por papel
  (antenas, lupa, barras, gota, pluma, ‹ ›; cualquier otro papel, como Legal, no lleva accesorio).
- Ánimo: `state` = `rest | work | wait | pause` (o `mood` = `libre | trabajando | espera | pausa`); sin él, sale del
  estado del bot (`status`, `enabled`). El destello de «trabajando» se queda quieto con movimiento reducido.
- `owner={{ name, color, you }}`: en el bot de otra persona, su chapa redonda con iniciales (punto a 20–24 px,
  inicial a 48, iniciales a 96). Tus bots no llevan chapa.
- Nombre accesible «Vera, bot de Lucía» / «Vera, bot tuyo» (`botA11yName`); `decorative` cuando el nombre ya está escrito
  al lado. Las personas nunca son `BotFace`: son círculos con iniciales (tú, con el tinte de tu familia).
- Ya lo usan `BotPresence`, `BotMark`, `AuthorAvatar`, las marcas de menciones, Equipo, la ficha del bot, Inicio, la barra
  lateral, Biblioteca, Código, Bienvenida y Pregunta rápida. Un retrato elegido para el bot se sigue mostrando.

## Comprobación
- `npx vite build` sin errores.
- `node scripts/a11y-scan.mjs <url>` (servidor con datos de QA, `scripts/seed-qa.mjs`): recorre las rutas principales y avisa de
  contraste bajo, controles de menos de 24 px o sin nombre, zonas `main` y saltos de encabezados; termina en 1 si encuentra algo.
- Compara visualmente `/_design/<Pantalla>` con la ruta real a 1440 px (el servidor de desarrollo
  ya está en http://localhost:4318; no arranques otro en ese puerto).
