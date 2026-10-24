# Personas: Colmenas de distintas personas

Colmena era de una sola persona y un solo ordenador. «Personas» deja hablar a varias, cada una en su propio ordenador y con sus bots, sin que ningún dato salga sin que el diseño lo diga. Diseño aprobado: tablero `design/V2Personas.dc.html` («v2 · 38 · Con otras personas»).

## De dónde sale (OpenClaw)
- `docs/concepts/multi-user.md` de OpenClaw es otra cosa: varias personas de confianza sobre un mismo gateway (un solo dominio de confianza). De ahí vienen la atribución de cada mensaje, las reacciones fuera del transcript, «escribiendo» y las menciones.
- Su canal A2A (A2A 1.0 por JSON-RPC) necesita un servidor alcanzable por HTTPS: no vale para dos escritorios detrás de un router.
- Lo que sí encaja es **Reef** (`docs/channels/reef.md`, `extensions/reef`, MIT): claves por instalación, sobres sellados y firmados, un relé que no puede leer, emparejamiento con código y huellas que se comparan fuera de banda, almacén anti-repetición. Colmena copia ese modelo con `node:crypto` (sin dependencias nuevas).
- OpenClaw no tiene salas de grupo entre instancias, libre/ocupado ni confirmación de varios dueños: eso es propio de Colmena.

## Protocolo (`server/peers/protocol.mjs`)
- **Identidad**: Ed25519 (firma; la clave pública en base64url es la dirección) + X25519 (cifrado). En Windows va en DPAPI (`windowsVault`, perfil `peer-identity`); sin DPAPI, en `<datos>/peers/identity.json` con permisos 0600.
- **Sobre** `{v, id, from, to, ts, epk, n, ct, sig}`: X25519 efímera con la clave del destinatario → HKDF-SHA256 (sal = epk‖clave del destinatario, info = `colmena-sobre-v1|from|to`) → AES-256-GCM; Ed25519 firma el sobre canónico. Máximo 48 KB de contenido, 30 días de antigüedad, 5 min de desfase. El id evita repeticiones (`peerSeen`, 31 días).
- **Peticiones al buzón**: cabecera `Authorization: Colmena <dirección>.<ts>.<nonce>.<firma>` sobre método, ruta, hora, nonce y hash del cuerpo. Sin cuentas ni contraseñas.
- **Invitación**: 80 bits al azar mostrados como `COLMENA-XXXX-XXXX-XXXX-XXXX`. La tarjeta (dirección, clave de cifrado, nombre) va cifrada con una clave derivada del código y guardada en el buzón bajo un identificador derivado del código; caduca en 24 h. Quien la acepta manda `hello` con una prueba HMAC ligada a las dos direcciones; quien invitó la comprueba, borra la tarjeta y responde `welcome`.
- **Palabras de seguridad**: cuatro palabras distintas (lista de 256) del SHA-256 de las dos direcciones ordenadas; las dos personas ven las mismas.
- **Mensajes**: `msg`, `seen`, `react`, `share` (lista de un grupo, solo la firma su dueño), `leave`, `profile`, `bye`, y efímeros `typing` y `presence` (el buzón no los guarda; Colmena tampoco).

## Conversaciones (`server/peers/service.mjs`)
- **Directa**: una por contacto, con un id derivado de las dos direcciones (las dos Colmenas lo calculan igual).
- **Grupo**: hasta 32 personas. No hay servidor que lo posea: cada mensaje se sella por separado para cada miembro. Quien lo crea firma la lista (con versión); las demás Colmenas solo aceptan listas suyas. A alguien que entra por un grupo y no es tu contacto se le guarda como «known»: puede escribir en ese grupo, no a ti a solas.
- **Papeles en un grupo**: `owner`, `member` y `guest` (escribe y lee, pero sus mensajes no despiertan bots: `bots.mjs`). Solo quien lo creó renombra (`renameGroup`), cambia papeles (`setRole`), quita (`removeMember`; a quien se quita le llega la lista sin él y un aviso) o añade. La lista lleva además la firma Ed25519 del dueño sobre su forma canónica (`roster().sig`): si viene firmada y la firma no cuadra, se ignora (las de Colmenas antiguas llegan sin firma dentro de su sobre firmado).
- **Invitación a una sala**: `createInvite(name, {room, role})`; la tarjeta dice el nombre de la sala y, al aceptar, quien invitó añade a esa persona con su papel.
- **Bandeja de salida** (`peerOutbox`): todo se pone en cola y se reintenta hasta que el buzón lo acepta; un mensaje pasa de «Enviando…» a enviado cuando todas sus copias han salido.
- **Estado** (`settings.status`, `statusNow` en `server/notifications.mjs`): «No molestar» o «Fuera» hasta una hora o hasta quitarlo. Viaja en el perfil firmado (`profile.status`) a tus contactos, que lo ven junto a tu nombre; mientras dura, `shouldPop` no saca ningún aviso ni suena (todo queda en Hoy). Caducado vale «Disponible».
- **Menciones de personas**: el mensaje lleva `people` (direcciones de miembros, hasta 16). A quien mencionan le llega un aviso `mention`, con su propio sonido, que salta también con «Solo lo importante».
- **Hilos**: una respuesta lleva `thread` (el id del primer mensaje; un nivel). Fuera de su hilo no se ve en la conversación: el primer mensaje dice cuántas respuestas tiene. En un grupo solo avisa a quien está en el hilo (quien lo empezó, quien ha respondido, quien sale mencionado). `replyTo` sigue siendo «contesta a» (lo usan los bots, que responden en el hilo si se les pregunta en uno).
- **Editar y borrar**: `edit {share,msg,text,at}` y `unsend {share,msg}`. Cada Colmena solo los acepta si el sobre (firmado por el remitente) viene del autor del mensaje; lo de los bots no se edita, solo se borra; una reunión se cancela, no se borra. Borrado queda «Mensaje borrado» sin texto, menciones ni reacciones, y el aviso sin leer que lo mostraba se va.
- **Búsqueda**: `search(q)` en este ordenador (todas las palabras, sin acentos ni mayúsculas), en una conversación o en todas (Ctrl+K). El buzón nunca ve qué buscas.
- **Límites**: 120 mensajes por minuto por remitente, 8000 caracteres por mensaje, 20 invitaciones abiertas. Los mensajes de otras personas se muestran como texto plano, nunca como HTML ni Markdown.

## Tareas de Código compartidas (`server/peers/codeshare.mjs`)
- El dueño elige con quién compartir una tarea. La tarea va siempre en su ordenador; a esas personas les llega `code.task` con una foto: título, proyecto, estado, rama, +/−, la PR (número, URL de GitHub, estado, CI) y el último plan de Bruno con lo que se ha dicho de él. Nunca el código, los archivos ni la conversación con Bruno. Lo que llega se limpia campo a campo (`cleanSnapshot`).
- `code.notice`: PR lista (abierta, CI en verde o sin CI) o CI fallando, una vez por PR y estado; plan nuevo esperando.
- Presencia: `code.view` (persona → dueño) y `code.viewers` (dueño → todos), solo en vivo, caducan a los 75 s; la pantalla avisa cada 30 s mientras la ventana se ve.
- `code.plan`: aprobar o pedir cambios. Solo se acepta de las personas con las que se comparte y sobre el plan abierto de esa tarea. Nunca arranca nada: el dueño recibe un aviso y decide «Implementar» o «Refinar con esto»; lo que pide la otra persona va a Bruno envuelto como contenido externo (no es una orden).

- **Todo un proyecto** (`code.project`): quien está invitado recibe todas sus tareas, el registro de trabajo en directo (`code.progress`, efímero, cada 4 s como mucho, sin contenidos de archivos), el diff bajo demanda (`code.diff.get` → `code.diff` en trozos de 20 KB, hasta 1 MB; si no cabe, solo la lista de archivos) y comenta líneas (`code.comment`). El código lo clona de su remoto (se le manda la URL de `origin`, sin credenciales). Una tarea compartida sola nunca da diffs ni comentarios.
- Comentarios: por persona, «Pregúntame» (por defecto, el dueño los pasa o descarta), «Siempre» (van a Bruno al momento) o «Nunca» (solo los ve el dueño). A Bruno le llegan con `code.send` como contenido externo con el trozo del diff como contexto, nunca como orden; las líneas rojas siguen.

- **Pedir revisión a…** (`code.review.ask` + el diff): vale aunque no esté invitada al proyecto (solo para esa tarea y esa revisión). Quien revisa va juntando hallazgos P0–P3 a mano (en las líneas) y de su bot (`runtime.infer` con su propia cuenta; el diff le llega envuelto como contenido externo) y manda `code.review {verdict, summary, findings}`. Solo se acepta de quien se pidió y una vez. En la tarea queda una tarjeta «Revisión de …» y, si hay hallazgos, Bruno la recibe con `code.send` como contenido externo.

## Encargos entre bots (`server/peers/errands.mjs`)
- Tus bots tienen la herramienta `ask_peer_bot {person, bot, request}` (si hablas con alguien que tiene bots; nunca dentro de un encargo). Envía `errand.ask` y espera hasta 4 minutos manteniendo vivo el turno; si no llega, la respuesta se escribe después en esa conversación como mensaje de ese bot, envuelta como contenido externo, y avisa.
- En la Colmena que recibe decide su dueño con el permiso de esa persona («Encargos a tus bots»: Pregúntame por defecto, Siempre, Nunca). «Pregúntame» pone una tarjeta local en vuestra conversación. Como mucho 6 encargos por persona y hora.
- Al aprobarse, el bot lo hace en un chat de incógnito (no aprende, caduca) cuyo `mission.capabilities` limita las herramientas a las elegidas en Ajustes › Personas › Encargos (web, carpetas, apps, ordenador; nunca más de las que el bot ya tiene: `Runtime#toolsForStep`). El encargo va envuelto como contenido externo y las líneas rojas siguen preguntando. La última respuesta vuelve con `errand.reply`.
- Quien pidió solo acepta `errand.state`/`errand.reply` de la persona a la que lo pidió; la respuesta pasa por `detectInjection` y, si intenta dar órdenes, llega con un aviso.

## Archivos y entregables (`server/peers/files.mjs`)
- Un sobre lleva 48 KB, así que un archivo viaja aparte: se sella aquí con AES-256-GCM y una llave nueva al azar, se corta en partes de 1 MiB y se deja en el buzón (`PUT /v1/blobs/:id/:n`, firmado). El mensaje (cifrado como todos) lleva la llave, un token de lectura y el SHA-256: solo quien está en la conversación puede abrirlo. El buzón ve tamaños y quién lo subió, nunca el contenido.
- Cada Colmena lo descarga una vez (`GET` con `X-Blob-Token`; el buzón guarda solo el hash del token), comprueba el hash, lo guarda en `<datos>/peer-files/<id>/` y olvida la llave. Si ya caducó, lo dice: «pídeselo otra vez».
- Tipos: imágenes, PDF, Word, Excel, PowerPoint y texto; 25 MB por archivo; 7 días en el buzón; 200 MB al día por quien sube. Un entregable de Colmena va con su PDF para verse tal cual.
- El visor nunca ejecuta nada del archivo: páginas de PDF dibujadas aquí, el texto de un Word (mammoth → bloques de texto), los valores de un Excel (exceljs), el texto de cada diapositiva. Imágenes y PDF se sirven con `sandbox` en la CSP; lo demás solo se descarga.
- Borrado para todos: desaparece del buzón y de cada Colmena.
- **Coste en el plan gratuito de Cloudflare** (100.000 peticiones al día de Workers y otras tantas de Durable Objects, 5 GB de almacenamiento SQLite): un archivo de 10 MB para 3 personas son unas 40 peticiones de Worker y unas 50 de Durable Objects (subir 10 partes con su cuota, bajar 10 por persona). Da para unos 2.500 archivos así al día entre todos los usuarios, y unos 700 MB al día de media guardados 7 días. Si se queda corto, el plan de 5 $/mes sube a 10 millones de peticiones; o se cambia a R2 (gratis 10 GB, pero pide tarjeta).

## Buzón (`relay/server.mjs`)
- `POST /v1/send`, `GET /v1/stream` (SSE con lo que espera y lo que llega), `POST /v1/ack`, `PUT|GET|DELETE /v1/invites/:lookup`, `GET /v1/health`. SQLite propio; guarda 7 días como mucho y borra al confirmar recepción. Comprueba que el remitente del sobre es quien firma la petición.
- Ve quién escribe a quién, cuándo y cuánto ocupa; nunca el contenido.
- Arranque: `node relay/server.mjs --port 4390 --host 127.0.0.1 --data .relay-data`. Colmena lo usa con `COLMENA_RELAY_URL` o Ajustes › Personas › «Dirección del buzón» (https, o http solo en este ordenador).
- En producción va el de Cloudflare (abajo); este sirve para pruebas y para quien quiera montar el suyo.

## Tus bots en conversaciones con personas (`server/peers/bots.mjs`)
- Cada Colmena anuncia a sus contactos sus bots (nombre, papel, color y forma; nada de lo que saben) en `hello`, `welcome` y `profile`.
- Un mensaje puede llevar `mentions` [{owner, bot}] (el selector «@») y `bot` (firmado como uno de tus bots: «Vera · bot de Sergio»). Tus mensajes sin menciones elegidas se leen buscando «@Nombre» de tus bots; los de otros, solo con menciones elegidas.
- Tu bot contesta en tu ordenador y con tu cuenta de IA, **sin herramientas, sin memoria ni perfil** (`sharedInstructions`: SOUL, papel, instrucciones y las reglas de la conversación compartida). Lo dicho antes y lo que pide otra persona van como contenido de fuera (`external-content.mjs`, con aviso si trae frases de inyección).
- Lo que pida otra persona solo lo atiende si en Ajustes › Personas tienes «Hablar con tus bots: Si los menciona» para ella (por defecto); «Nunca» lo calla. Los bots nunca despiertan a otros bots, y como mucho 20 respuestas por hora y conversación. Si no puede contestar, te lo dice solo a ti (mensaje `local`, que no sale).

## Reuniones entre dueños (`server/peers/meetings.mjs`, `server/peers/calendar.mjs`)
- Lo empiezas tú: «@Atlas búscanos un hueco la semana que viene, 45 minutos, por las mañanas». La petición se lee con reglas (minutos, días, franja) de tu mensaje y los últimos de la conversación; sin pistas, 45 minutos en los próximos 7 días de 9 a 18.
- Protocolo dentro del sobre (como las tareas de A2A, pero sin servidor): `meet.ask` (quien organiza → cada miembro), `meet.busy` (miembro → quien organiza: bloques ocupados o «no comparte»), `meet.vote` (miembro → quien organiza), `meet.state` (quien organiza → todos). Solo quien organiza puede cambiar el estado.
- Cada Colmena decide con «Cuándo estás libre» para quien pregunta: «Pregúntame» (tarjeta en la conversación con lo que se enviaría), «Siempre» o «Nunca». El código lee la agenda y se queda con inicio y fin redondeados a 15 min: nunca títulos, lugares ni personas. Los bloques solo los recibe quien organiza; los demás ven los huecos propuestos.
- Huecos: días laborables, dentro de la franja, sin pisar nada de nadie, uno por día y si faltan separados 90 min; se marca el más tranquilo. Si alguien dice «Ninguno me va», otra ronda (hasta 4).
- Cuando todos dicen que sí al mismo hueco, cada Colmena lo apunta en su propio Google Calendar sin invitados (`GOOGLECALENDAR_CREATE_EVENT`; se descarta si llevara invitados). Sin calendario conectado, la tarjeta lo dice.

## Buzón en Cloudflare (`relay/cloudflare/`)
- Mismo contrato que `relay/server.mjs`, sobre Workers + Durable Objects con SQLite (plan gratuito): un objeto por buzón (dirección) y otro por tarjeta de invitación, con alarma para borrar lo caducado (7 días el correo, 25 h las tarjetas).
- La entrega en directo es un WebSocket con hibernación (`/v1/ws?auth=…`): mientras no llega nada no se paga tiempo, y el «ping» de cada 25 s lo contesta Cloudflare sin despertar el objeto. `GET /v1/health` dice `stream: "ws"`; el de Node dice `"sse"` y el cliente elige solo (`relay-client.mjs`).
- Las firmas se comprueban con WebCrypto Ed25519. El registro de peticiones está apagado (`observability.enabled = false`).
- Probarlo en local: `cd relay/cloudflare && npm install && npx wrangler dev --local --port 8787`, y `COLMENA_TEST_RELAY=http://127.0.0.1:8787 node --test --test-concurrency=1 tests/peers*.test.mjs` (las mismas 17 pruebas).
- **Desplegado** el 2026-10-24 en la cuenta de Cloudflare del dueño de Colmena: `https://colmena.klast-lab-fa693a.workers.dev` (Worker `colmena`). Es `DEFAULT_RELAY` (`server/peers/service.mjs`): todas las Colmenas lo usan sin configurar nada; nadie más necesita una cuenta. Volver a desplegar: `npx wrangler deploy` desde `relay/cloudflare/` (con `npx wrangler login` hecho). Las 19 pruebas pasan contra él (`COLMENA_TEST_RELAY=https://colmena.klast-lab-fa693a.workers.dev`).
- Coste: el plan gratuito cubre 100 000 peticiones al día; cada mensaje a N personas son N envíos y N confirmaciones. Si se quedara corto, el plan de pago de Workers son 5 $/mes.

## Pruebas
- `tests/peers.test.mjs`: tres Colmenas reales (Sergio, Marta, Luis) sobre un buzón local: invitación de un solo uso y palabras iguales, extraños ignorados, chat directo con visto y reacciones, mensajes que esperan con la otra Colmena cerrada, grupo de tres con la lista firmada, listas falsas ignoradas, presencia y «escribiendo» sin guardar, quitar un contacto.
- `tests/peers-bots.test.mjs`: tu mención despierta a tu bot (sin herramientas ni memoria), la de otro llega como contenido de fuera, «Nunca» lo calla, un bot no despierta a otro, el selector «@» dice de quién es el bot, un fallo solo lo ves tú.
- `tests/peers-meetings.test.mjs`: lectura de la petición (también con el cambio de hora), bloques sin títulos, huecos; tres dueños con calendarios simulados («Siempre», «Pregúntame», «Nunca»), solo quien organiza ve los bloques, votos, otra ronda, estados falsos ignorados y un evento sin invitados en cada calendario.
- Prueba real en este PC: `.claude/launch.json` › `mu-relay`, `mu-sergio`, `mu-marta`, `mu-luis` (datos en `.local/mu-*`); con modelo y calendarios simulados, `mu-h-sergio`, `mu-h-marta`, `mu-h-luis` (`.local/mu-harness.mjs`, datos en `.local/muh-*`).

## Fases
1. **Hecho**: identidad, buzón, invitaciones, chats directos y grupos de personas, «visto», reacciones, «escribiendo», presencia, Ajustes › Personas.
2. **Hecho**: tus bots en conversaciones con personas.
3. **Hecho**: bots de distintos dueños que acuerdan una reunión mirando solo libre/ocupado, con el sí de todos.
4. Pendiente: buzones federados (cada dirección con su buzón), puente A2A HTTP con agentes externos (OpenClaw), roles de sala (editor, invitado) y archivos compartidos.
