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
- **Bandeja de salida** (`peerOutbox`): todo se pone en cola y se reintenta hasta que el buzón lo acepta; un mensaje pasa de «Enviando…» a enviado cuando todas sus copias han salido.
- **Límites**: 120 mensajes por minuto por remitente, 8000 caracteres por mensaje, 20 invitaciones abiertas. Los mensajes de otras personas se muestran como texto plano, nunca como HTML ni Markdown.

## Buzón (`relay/server.mjs`)
- `POST /v1/send`, `GET /v1/stream` (SSE con lo que espera y lo que llega), `POST /v1/ack`, `PUT|GET|DELETE /v1/invites/:lookup`, `GET /v1/health`. SQLite propio; guarda 7 días como mucho y borra al confirmar recepción. Comprueba que el remitente del sobre es quien firma la petición.
- Ve quién escribe a quién, cuándo y cuánto ocupa; nunca el contenido.
- Arranque: `node relay/server.mjs --port 4390 --host 127.0.0.1 --data .relay-data`. Colmena lo usa con `COLMENA_RELAY_URL` o Ajustes › Personas › «Dirección del buzón» (https, o http solo en este ordenador).
- Despliegue previsto (pendiente de la cuenta y el OK del usuario): Cloudflare Workers + Durable Objects (0–5 $/mes) o una máquina pequeña de Fly.io (2–5 $/mes).

## Pruebas
- `tests/peers.test.mjs`: tres Colmenas reales (Sergio, Marta, Luis) sobre un buzón local: invitación de un solo uso y palabras iguales, extraños ignorados, chat directo con visto y reacciones, mensajes que esperan con la otra Colmena cerrada, grupo de tres con la lista firmada, listas falsas ignoradas, presencia y «escribiendo» sin guardar, quitar un contacto.
- Prueba real en este PC: `.claude/launch.json` › `mu-relay`, `mu-sergio`, `mu-marta`, `mu-luis` (datos en `.local/mu-*`).

## Fases
1. **Hecho**: identidad, buzón, invitaciones, chats directos y grupos de personas, «visto», reacciones, «escribiendo», presencia, Ajustes › Personas.
2. Tus bots en conversaciones con personas: responden si los mencionan, con el contexto como contenido de fuera, y sin usar tus cuentas por lo que pida otro.
3. Bots de otros dueños que negocian: petición estructurada (A2A dentro del sobre), libre/ocupado calculado por código, propuesta de huecos y confirmación de todos; cada uno lo apunta en su propio calendario.
4. Buzón en la nube (con OK) y puente A2A con agentes externos (OpenClaw).
