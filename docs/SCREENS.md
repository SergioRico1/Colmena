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
- Datos de QA de Código: `COLMENA_DATA_DIR=.local/qa-code node scripts/seed-code-qa.mjs` crea repos git desechables y tareas en cada estado
  (trabajando, te espera, revisión P0–P3, PR con CI, conflictos, compartida, traspaso, comparar); con `--serve` lo sirve con motores falsos.
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

### Menús: `<MenuButton>`, `useContextMenu`
- Un solo menú en toda la app: `src/components/Menu.js` (lo puro en `src/lib/menu.js`; aspecto en `base.css` › `.c-menu`,
  el menú de perfil de `design/v4`: superficie `raised`, línea fina, `shadowPop`, filas de 32 px a 14 px).
  `<MenuButton label="Más opciones" items={[…]}>…</MenuButton>` para un «…» o un selector; `useContextMenu(build)` para el
  clic derecho de una parte de la página (el resto lo atiende `ContextMenu.jsx`, hecho con el mismo menú).
- Entradas: `{ label, icon, hint, shortcut, meta, onSelect | href, disabled: "por qué", danger, checked, radio, items,
  confirm: { title, text, action }, panel: ({ close, back }) => … }` o grupos `{ group: "Título" | <elemento> | null, items,
  note }`. Lo destructivo va siempre al final y en rojo; si no se puede deshacer, `confirm` pregunta dentro del propio menú.
  `panel` cambia el menú por un formulario pequeño suyo («Elegir día y hora…»; Escape vuelve). `note` es una línea discreta
  bajo los elementos del grupo; `footer` (en `MenuButton`) otra al pie del menú. Un `disabled` que ya se ve en `hint` no se
  lee dos veces. Código usa este menú en todo («…» de tarea y proyecto, «Más acciones», pickers de motor, proyecto, puntos
  y servidores): no hay otro kit.
- Contenido: agrupado por intención, ≤ 7 por grupo, lo que no es una acción fuera del menú, y nada que ya tenga un
  control visible al lado (ni «Solo para mí», que vive en el chip del compositor).

## Anchos: móvil, tableta y portátil
Colmena se dibujó para una ventana de escritorio (1440×960, mínimo 760×600) y también se usa en un navegador, en el móvil
y en la tableta. Tres anchos, los mismos en CSS (`src/styles/responsive.css`, con `--bp-tablet` y `--bp-laptop` en `:root`)
y en JS (`src/lib/breakpoint.js`):

| Ancho | Media query | Qué cambia |
|---|---|---|
| Móvil, < 640 px | `(max-width: 639.98px)` | Una columna. La barra lateral es un cajón (`nav[data-drawer]`) tras una barra superior `.c-topbar` (menú, dónde estás, «Ir a…», «Nuevo») con márgenes seguros. Paneles, hilos y diálogos ocupan la pantalla; los menús suben desde abajo. |
| Tableta, 640–1023 px | `(max-width: 1023.98px)` | La barra es siempre el carril plegado; «Desplegar» la abre entera sobre el contenido. Los paneles laterales (`.r-overlay`) se superponen. |
| Portátil, ≥ 1024 px | sin query | El diseño de escritorio, píxel a píxel. |

- **CSS antes que JS.** Las pantallas usan clases en lugar de comprobar el ancho: `.r-stack` / `.r-stack-tab` (una fila que
  pasa a columna), `.r-grid-1`, `.r-pad`, `.r-full`, `.r-hide-phone`, `.r-wrap` + `.r-grow` (los botones bajan bajo el
  nombre), `.r-scroll-x` (pestañas y chips que se deslizan), `.r-xbox` (una matriz ancha con su propio scroll), `.r-overlay`
  (panel lateral, con `<OverlayBack>` como primera fila), `.r-table` (filas apiladas, cada celda con `data-label`) y
  `.r-composer`. `useBreakpoint()` solo cuando se pinta algo distinto (la barra lateral, el estado inicial de un panel).
- **Entrada, no ancho.** `(pointer: coarse)` lleva cada control a 44×44 px de zona de toque sin cambiar su dibujo, filas de
  menú de 44 px y campos de 16 px (iOS no hace zoom); `(hover: none)` enseña lo que el ratón descubre al pasar, un toque
  en un mensaje enseña su barra de acciones y una pulsación larga abre el menú del clic derecho (`src/lib/longPress.js`).
  Los buscadores llevan `inputMode="search"`, los compositores `enterKeyHint="send"` y los nombres su `autoComplete`. `.r-hide-touch` / `.r-only-touch` para los
  atajos de teclado.
- **Navegador sin la app de escritorio.** Sin `window.colmenaWindow` (`html.colmena-web`) no se dibujan los botones de la
  ventana, «Pregunta rápida», las capturas de pantalla, «Mostrar en el Explorador» ni «Actualizaciones»: o el componente
  comprueba `isDesktopApp()` o el control lleva `data-desktop-only`.
- **Teclado del móvil.** `--app-h` sigue la altura visible (`visualViewport`) y la `.c-shell` mide eso: el compositor queda
  encima del teclado.
- **Comprobación.** `node scripts/responsive-shots.cjs --base=<url> [--all] [--desktop]` hace capturas a 375, 768, 1280 y 1440
  en claro y oscuro (`.local/shots/responsive/`) y falla si algo se sale por la derecha; `node scripts/shot-diff.mjs <antes>
  <después>` compara dos carpetas píxel a píxel (con `--desktop` las capturas imitan la app de escritorio).

## Invitar: un solo modelo y unas mismas palabras
Traer a alguien a Colmena, a una sala o a un mensaje directo usa siempre las mismas piezas
(`src/components/people/`, reglas puras en `src/lib/invite.js`, estilos en `src/styles/invite.css`).

- **Una sola hoja «Invitar»** (`InviteSheet`), abierta con su contexto:
  - una sala (`{kind: "room", room}`): «Personas» (busca entre tu equipo y quien ya habla contigo, elige varias, papel
    Miembro o Invitado explicado en una línea, «Añadir a …»; si la sala no es tuya, «Pedírselo a <dueño>») y
    «Invitar a alguien que aún no está» (un código para esa sala). Siempre dice antes la verdad: «Verán lo que se escriba
    a partir de ahora, no lo anterior.»;
  - un equipo (`{kind: "team", team}`): un código (entrar en un equipo lo decide quien entra, también si ya habláis);
    quien no administra lee quién puede invitar;
  - nada: un código para hablar a solas.
- **El código** (`CodePanel`): grande y seleccionable, «Copiar mensaje» (el `inviteText` del servidor: quién eres, qué es
  Colmena, dónde se instala y dónde pegar el código), «Copiar código», «Caduca en 24 h · sirve una sola vez», el mensaje
  que se copia a la vista y por qué se comparan de viva voz las cuatro palabras. Debajo, los códigos de ese contexto sin
  usar con «Copiar de nuevo» y «Revocar».
- **«Nuevo mensaje»** (`NewMessageSheet`): el «+» de Personas y «Nuevo › Mensaje directo». Elegir a alguien abre su
  conversación al momento (a un compañero de equipo no le hace falta código); a quien aún no alcanzas, «Invitar a alguien
  que aún no está» desde el mismo sitio.
- **«Unirme con un código»** (`JoinSheet`, `JoinFlow` en la bienvenida): un campo para cualquier código; al pegarlo dice qué
  es (de equipo, de sala, para hablar), quién invita y a qué, las cuatro palabras y «Coinciden · …»; estados claros para
  caducado/usado/revocado, buzón inalcanzable y éxito (a dónde lleva).
- **Pendiente**: en neutro donde corresponde (el panel de miembros de la sala, Equipo, Ajustes › Contactos y equipos). La
  petición «añade a esta persona» es miel solo para el dueño de la sala (`RoomAddRequests`, sobre el cuadro de escribir,
  y en «Te necesitan»); quien la pidió lee «Pendiente: se lo hemos pedido a Sergio».
- **Mensaje directo**: la cabecera dice quién es (avatar, nombre, presencia, estado, equipo) y su menú «…» (`DmMenu`):
  «Ver perfil», «Silenciar», «Archivar», «Quitar de contactos», cada uno con lo que significa debajo.
- **Sin poder invitar** (`inviteBlock`): sin buzón, «Para invitar a gente, Colmena usa un buzón cifrado.» con «Actívalo»;
  sin conexión, los códigos esperan a que vuelva; preparando las claves, en unos segundos.

Vocabulario (`WORDS` en `src/lib/invite.js`; no se usan otras formas):

| Palabra | Dónde |
| --- | --- |
| «Invitar» | el verbo de los botones (cabecera de la sala, panel de miembros, Equipo, vacíos) |
| «Invitar a alguien que aún no está» | el camino del código, en todas partes |
| «Unirme con un código» | el único sitio donde se pega un código (también lo dice el mensaje que se copia) |
| «Mensaje directo» / «Nuevo mensaje» | hablar a solas con una persona / la hoja para empezar a hacerlo |
| «Pendiente» | lo que espera a otra persona: un código sin usar, una petición al dueño |
| «Revocar» | un código deja de servir al momento |
| «Copiar mensaje», «Copiar código», «Copiar de nuevo» | lo que copias para mandarlo tú |

Retirados: «Invitar a una persona», «Invitar a alguien», «Invitar a la sala», «Hablar con una persona», «Tengo una
invitación», «Unirme a un equipo», «Reenviar», «Cancelar la invitación», «Invitar con un código».

## Comprobación
- `npx vite build` sin errores.
- `node scripts/a11y-scan.mjs <url>` (servidor con datos de QA, `scripts/seed-qa.mjs`): recorre las rutas principales y avisa de
  contraste bajo, controles de menos de 24 px o sin nombre, zonas `main` y saltos de encabezados; termina en 1 si encuentra algo.
- Compara visualmente `/_design/<Pantalla>` con la ruta real a 1440 px (el servidor de desarrollo
  ya está en http://localhost:4318; no arranques otro en ese puerto).
