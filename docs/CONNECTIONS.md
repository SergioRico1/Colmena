# Conectores de Colmena

## Marketplace (2026-11-14)

Ajustes › Apps y carpetas › **Marketplace** (`src/components/v2/settings/Marketplace.jsx`; cada app en
`/ajustes/apps?app=<id>`): todas las apps con su conexión oficial, búsqueda, categorías, estado
(Conectada, Falta tu permiso, Disponible pronto, Beta, Vista previa), qué pueden hacer los bots, sus
líneas rojas, cómo se conecta, el formulario de su tipo, tus conexiones con «Probar» y «Desconectar»,
y las fuentes. Igual en el escritorio y en la nube; funciona a 375 px, claro y oscuro.

El catálogo es un dato (`server/mcp/catalog.mjs`): proveedor, nombre, logo, categoría, descripción,
endpoint, transporte, tipo de autenticación, estado, lectura/escritura, líneas rojas, pasos,
«verificado el» y fuentes. Solo entra lo comprobado en la documentación del proveedor; lo no
comprobable queda con `listed: false` (sigue reconectando lo que ya existía). Tipos:

| auth | Qué es | Ejemplos |
| --- | --- | --- |
| `oauth` | MCP remoto del proveedor con OAuth y registro dinámico: un clic | Notion, Linear, Atlassian (v2), monday, ClickUp, Miro, Airtable, Stripe, Square, Close, Wix, Sentry, Supabase, Cloudflare, Calendly, Holded, Factorial, Zapier |
| `token` | MCP remoto con una clave pegada, en la cabecera del proveedor | GitHub (token personal), Intercom, PostHog, Brevo, Google Maps (`X-Goog-Api-Key`) |
| `mail` | Conector de correo de Colmena por IMAP/SMTP con contraseña de aplicación | Gmail, Workspace, iCloud, Yahoo, Fastmail |
| `composio` | Apps de Composio con **tu propia cuenta de Composio** (o la de la empresa) | Gmail, Google Calendar, Drive, Sheets, Outlook, Slack, HubSpot, Asana, «Otras apps» |
| `google` | El cliente OAuth propio de Colmena (un único cliente, solo permisos sensibles, sin CASA) | Google Analytics (servidor oficial que ejecuta Colmena), BigQuery. «Disponible pronto» hasta que exista el cliente |

Bloqueadas aunque exista el cliente («Disponible pronto» con el motivo): los MCP de Workspace (Calendar,
Docs, Sheets…) por las condiciones del Developer Preview, y Google Ads porque su permiso es
restringido. Guías: `docs/GMAIL-CONTRASENA-APLICACION.md`, `docs/GOOGLE-ANALYTICS-ADS.md` y la lista
del propietario `docs/GOOGLE-CLIENTE-COLMENA.md`.

### Piezas

- `server/mcp/hub.mjs`: registros `mcpServers` con `auth`, `run`, `owner` y `account`. `owner: null` es
  de la empresa (todos sus bots); el id de una persona es solo suyo: nadie más lo ve, lo usa ni lo
  quita, y solo los turnos de esa persona lo reciben. Las apps `perPerson` (correo, Google, Calendly,
  Factorial, GitHub) son siempre personales; las demás, para la empresa si conecta un propietario o
  administrador sin «Mis propias apps», si no personales. Los miembros nunca conectan para todos.
- `server/mcp/google.mjs`: PKCE S256, estado, `access_type=offline`, intercambio, renovación
  (dos minutos antes de caducar, y una vez forzada tras un 401), revocación al desconectar, y las
  credenciales `authorized_user` para los servidores locales. Rechaza cualquier permiso restringido.
- `server/mcp/local.mjs`: servidores oficiales locales por stdio a través de la costura de procesos
  (`server/machine/seam.mjs`): hijo de este ordenador (`pipx run --spec …`) o la máquina de la empresa
  (`POST /machine/mcp`, `/opt/mcp/bin/*` en la imagen). Las credenciales viven solo en una carpeta
  privada del proceso (0600), fuera de las copias de la máquina, y se borran al pararlo.
- `server/mcp/mail.mjs`: IMAP (buscar, leer sin marcar, carpetas, borradores con APPEND, mover,
  etiquetas de Gmail, leído) y SMTP (envío; copia en Enviados salvo Gmail) por una costura TCP:
  `node:tls` en el escritorio, `connect()` de `cloudflare:sockets` en la nube (`cloud/src/tcp.js`;
  el puerto 25 está bloqueado: 465 o 587). Microsoft se rechaza con su motivo (exige OAuth).
- `server/mcp/routes.mjs`: `GET /api/mcp/catalog`, `POST /api/mcp/connect {catalogId|url, token?,
  mail?, scope?}`, `POST /api/mcp/servers/:id/test` («Probar»), `DELETE`, y `GET|PUT|DELETE
  /api/mcp/composio` (tu propia clave de Composio, comprobada contra Composio antes de guardarla).

### Composio con tu propia cuenta

Composio deja de ser solo infraestructura del operador: cada persona puede crear su cuenta gratuita
(composio.dev; el plan gratuito, a 14-11-2026: 10.000 llamadas al mes, 5 conexiones compartidas,
hasta 10 cuentas por app) y pegar su clave. Escritorio: `connections.manage("configure")` (DPAPI).
Nube: el perfil de Composio de la persona (`p-<id>` en el almacén `connections`) con **su** clave,
`apps-mine:<id>` con `ownKey: true`; gana sobre la de la empresa para esa persona y un cambio de la
clave de la empresa no la toca. La clave de empresa (`PUT /api/cloud/apps/key`) sigue igual. Los
datos pasan por Composio, un tercero, y la pantalla lo dice. Condiciones de Composio: no prohíben
expresamente que un usuario use su clave dentro de otro producto, pero la licencia excluye «resale or
commercial use of the platform»: conviene confirmarlo por escrito con Composio.

### Líneas rojas de las herramientas MCP (`mcpPolicy`, `server/mcp/tools.mjs`)

- **Línea roja** (siempre espera tu OK, nunca «Permitir siempre»): verbos que envían, responden,
  reenvían, borran, pagan, cobran, reembolsan, publican, invitan, comparten, reservan, despliegan,
  fusionan o ejecutan SQL; `destructiveHint: true`; dinero o publicación por nombre o por app (la
  misma regla que Composio, `movesMoneyOrPublishes`); y un cambio que llega a personas
  (`openWorldHint` con message/email/campaign…). Las anotaciones del servicio nunca quitan una línea roja.
- **Libre**: `readOnlyHint: true`, un verbo de lectura, o un nombre que dice «readonly».
- **Con OK**: cualquier otro cambio (se queda en tu cuenta).
- Un envío con forma de correo (to + asunto/cuerpo) se revisa como un correo (`kind: "send"`,
  `email`), editable en «Revisar»; sale como lo dejaste. Un borrador dice para quién y qué lleva.
  Aprobación previa, delegación y «Rutinas sin supervisión» siguen como estaban.

Pruebas: `tests/marketplace.test.mjs` (catálogo, Google falso con PKCE/estado/renovación, servidores
locales por la costura en escritorio y máquina, correo con buzón falso, líneas rojas, secretos
cifrados y aislamiento entre empresas y personas, rutas, un espacio alojado). Desplegado
(app.colmena.team, 2026-11-14): `node cloud/scripts/e2e-marketplace.mjs --url … --env …` 20/20
(catálogo en 351 ms, un buzón inalcanzable falla con un mensaje claro por los sockets del Worker en
417 ms). Capturas de portátil y móvil en `.local/shots/marketplace/`.

## Implementacion

Motor reutilizado: NEXO alpha.29, app/ai/composio.mjs y sus listas auditadas de lectura. Licencia conservada en licenses/NEXO.txt. Adaptaciones: identidad colmena-composio-v1, usuario remoto propio y vault explicito bajo LOCALAPPDATA/Colmena/connections. No se leen ni migran secretos de NEXO.

(Hasta el 2026-11-14; ahora cada persona puede usar su propia cuenta de Composio: ver «Marketplace».) Composio era infraestructura interna. La UI no incluía su nombre, clave, configuracion ni endpoint para introducirla. El operador puede provisionar COLMENA_COMPOSIO_KEY en el entorno del proceso servidor; la clave se valida, se cifra con Windows DPAPI y se elimina del entorno del proceso. Nunca debe incluirse en el bundle, repositorio, URL, argumentos de terminal ni logs. Sin provisionamiento se indica indisponibilidad del servicio, no se pide una clave al usuario.

Este provisionamiento es adecuado para desarrollo local. Una distribucion publica necesita un backend gestionado con identidad de usuario, cuotas y aislamiento por tenant. NO distribuir una clave de proyecto compartida dentro del instalador: DPAPI local no la oculta al propietario de Windows. Esa infraestructura no esta desplegada.

Referencias tecnicas contrastadas: https://docs.composio.dev/reference/api-reference/tool-router y https://docs.composio.dev/reference/api-reference/tool-router/postToolRouterSessionBySessionIdExecute

## Interfaz

Entrada: /connections/Connections.dc.html, enlazada desde Ajustes. Fuente 09b original. Estados, catalogo, busqueda, conexion, deteccion del retorno OAuth, varias cuentas y desconexion usan API real, sin alternancias simuladas a Conectada.

09c alimenta tres dialogos: nombre de cuenta, lectura, envio. Nombre editable y presets; JSON tecnico plegable; permiso recordable solo para lecturas auditadas. El envio exige mantener pulsado 1,2 segundos (puntero o teclado). Un clic corto no ejecuta.

El motor conserva propuestas privadas, caducidad, revalidacion de esquema/cuenta, recibos duraderos antes del efecto y bloqueo de repeticion incierta. La decision de usuario usa una revision opaca que se invalida al cambiar cuenta/clave. Las propuestas pendientes sobreviven en SQLite; tras reinicio requieren abrir y revisar nuevamente. Una accion en curso durante un cierre queda incierta, nunca se repite automaticamente.

## Limites pendientes de diseno

- Editar envio: Para, CC/CCO, asunto, cuerpo, adjuntos, cancelar y guardar cambios. Guardar vuelve a revision; no envia. El boton Editar esta desactivado hasta recibir esa pantalla.
- Confirmacion para otras escrituras: eventos de Calendar, cambios de documentos, borrados, etc. No se habilitan extrapolando el dialogo de correo.
- 09b/09c son lienzos de 1440px de ancho fijo. No existe variante movil. Las listas extensas de cuentas/catalogo necesitan estado de desbordamiento o paginacion definido; no se ha inventado otra composicion.
- Navegacion de ajustes NEXO (General, Espacios, Privacidad, etc.) no tiene pantallas Colmena suministradas; enlaces desactivados. Los controles decorativos de ventana del original no gobiernan una ventana del navegador web.
- Servidores MCP propios: disponibles por HTTP/SSE con OAuth (registro dinamico, PKCE, tokens en DPAPI) en `server/mcp/hub.mjs`; los servidores locales por stdio solo para los oficiales del Marketplace (`server/mcp/local.mjs`).
- En la nube (docs/CLOUD.md › Phase 3): la clave de Composio es de la empresa (la pone quien administra, cifrada en el almacén del espacio); MCP vuelve a `https://<sitio>/api/mcp/oauth/callback` en lugar de una dirección local; las líneas rojas de una rutina las deciden su dueño y la persona de la empresa en quien delegó, sin buzón.

## Líneas rojas de las rutinas: «Aprobado por adelantado» (`server/preapprovals.mjs`)

Una línea roja (enviar, publicar, borrar, invitar, una orden de riesgo…) siempre espera tu OK. En una rutina que trabaja sin nadie delante tiene tres salidas:

- **Sin más** (por defecto): espera a que la apruebes.
- **Ajustes › Autonomía › «Rutinas sin supervisión»** (`settings.unattended`, `isUnattended` en `server/redlines.mjs`): no espera; queda «pendiente para después» en la Bandeja y el bot termina lo demás (`deferredResult`, `pendingSummary`).
- **«Aprobado por adelantado»**: la rutina guarda lo que puede hacer a su hora aunque no estés. Va antes de las otras dos.

Qué se guarda (`automation.preapprovals: [{id, label, tool, toolkit, account, slug, recipients?, command?, uses, createdAt, boundMission, usedCount, lastUsedAt}]`):

- `apps_execute`: la acción de Composio (slug en mayúsculas), su app y su cuenta. En un envío (o algo que llega a personas: invitados, CC/CCO), también **a quién va**, en minúsculas. Más tarde solo vale si todos a los que va estaban en la lista guardada (un subconjunto: a menos gente sí; a alguien nuevo, no).
- `run_command`: el programa, los argumentos y la carpeta, exactamente iguales.
- `uses: "next"` («Solo la próxima vez»): se ata a la primera misión que la usa (`boundMission`); dentro de esa misión sigue valiendo, en las siguientes no. Después se ve como «Usada». `uses: "always"` («Siempre»): en cada misión de esa rutina.

Nunca se puede:

- pagar, comprar o mover dinero (PAY, PAYOUT, CHARGE, REFUND, TRANSFER, PURCHASE, ORDER, y también BUY, CHECKOUT, SUBSCRIBE, RESERVE…; y cualquier cambio en una app de pagos o tienda);
- preguntas, planes, habilidades, SOUL, vueltas atrás de lo aprendido ni claves;
- gestores de contraseñas, contraseñas, inicios de sesión del navegador (`browser_sign_in`) o del terminal (`op`, `bw`, `lpass`…);
- nada en un paso que leyó frases de inyección (`isFlagged`), en un turno para otra persona (`peerErrand`) ni en incógnito.

Cuándo se usa: solo dentro de una misión de **esa misma** rutina, con o sin supervisión, antes del camino de «pendiente para después» o de preguntarte. En apps, en `Connections#request` (`takePreapproval` → `decide` con `by: "rutina"`); en `run_command`, en `server/computer/wire.mjs` (`Runtime#preapproved`). La aprobación queda con `decidedBy: "rutina"` y «Aprobado por adelantado en la rutina «<nombre>»», el chat lleva una línea de actividad y la entrada suma `usedCount` y `lastUsedAt`.

De dónde sale (nunca de algo que la rutina no te haya pedido):

1. La tarjeta de aprobación (pendiente o dejada para después, en una misión de rutina, si se puede guardar: `approvalView().preapprove`) tiene «Aprobar y dejarlo aprobado en esta rutina» con «Solo la próxima vez» / «Siempre» (menú compartido `src/components/Menu.js`). `POST /api/approvals/:id {decision: "approved", revision, preapprove: "next"|"always"}`; con «denied», con `always` o con algo que no se puede guardar responde 400 sin decidir nada.
2. La página de la rutina (Trabajo › Rutinas › «Cambiar la rutina» o «Aprobado por adelantado» en su menú, `src/components/rutinas/RoutineApprovals.jsx`): la lista con a quién va o qué orden, «Solo la próxima vez» / «Siempre» / «Usada», las veces y la última, y «Quitar». «Añadir» ofrece solo lo que esta rutina pidió en ejecuciones anteriores y se puede guardar, una vez por clave.
   - `GET /api/automations/:id/preapprovals` → `{entries, candidates, approver, people}`
   - `POST /api/automations/:id/preapprovals {approvalId, uses}` (la aprobación tiene que ser de una misión de esta rutina)
   - `DELETE /api/automations/:id/preapprovals/:entryId`
   - `PUT /api/automations/:id/approver {contactId | null}` («Quién decide sus líneas rojas», docs/PEOPLE.md «Delegar aprobaciones»).

Pruebas: `tests/preapprovals.test.mjs` (claves, exclusiones, «próxima vez» y «siempre», otra rutina, el camino de apps y el de `run_command`, la ruta con `preapprove` y las de la página de la rutina).

## Verificacion 2026-10-15

- Pruebas Node aisladas para el motor heredado, permisos de Colmena, API sin configuracion de secretos, bloqueo de duplicados y restauracion segura.
- Prueba de fidelidad: cada estilo inline retenido y el stylesheet de 09b/09c coincide con el fuente; unica adicion funcional al bloque de correo: preservar saltos de linea y envolver palabras/direcciones largas para no ocultar contenido revisado. Las referencias originales permanecen intactas.
- Playwright contra fixture desechable, sin red externa ni cuentas reales: busqueda, filtros, nombre libre/presets, lectura, permiso recordado, pulsacion mantenida, clic corto sin efecto y desconexion.
- Comparacion visual guardada en output/playwright/connections-*.png. Cabecera 09b original e integrada: x328 y96, 800x41. Sin errores JS en los flujos probados.
- A 390px se observa el ancho original de 1440px; se registra como limitacion, no como responsive aprobado.
- OAuth de apps, acceso real Gmail/Calendar e instalador nativo no se han verificado. No se han enviado correos ni conectado cuentas reales.

Reproducir: npm run verify.
