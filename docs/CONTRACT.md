# Contrato frontend ⇄ backend de Colmena

Fuente única para quien implementa pantallas (src/screens) y servidor (server/).
Todo en español en la UI; identificadores en inglés o español según se indica.
Mutaciones: JSON + cabecera `X-Colmena-Token` (lo hace `src/lib/api.js`).

## 1. Estado global — `GET /api/state`

Ligero: nunca incluye contenidos grandes (texto de artefactos, SKILL.md, SOUL).

```js
{
  account: { connected: true, email, plan } | null,   // sesión ChatGPT
  provider: { kind: 'chatgpt'|'apikey'|'local'|null, label },
  authError: string|null,
  models: [{ slug, label }],
  settings: {
    model, spaceName: 'Equipo de operaciones', userName: 'Tu cuenta', userRole: 'Administrador',
    onboarded: bool, learning: true,
    limits: { monthlyTokens: number|null, pauseAtLimit: bool, warnAt80: bool },
    fallback: 'local'|'none',
  },
  usage: { monthTokens, limitTokens|null, percent|null },
  paused: bool,                       // "Pausar a todo el equipo"
  bots: [Bot], missions: [Mission], approvals: [Approval],
  automations: [Automation], suggestions: [Suggestion],
  skills: [SkillSummary], memories: [Memory], artifacts: [ArtifactSummary],
  folders: [Folder], people: [Person], connectors: [Connector]
}
```

### Bot
```js
{ id, name, role, instructions, color: '#RRGGBB',
  shape: 'hex'|'circle'|'square'|'diamond'|'arch'|'leaf',
  enabled, builtin, audience: 'yo'|'equipo',
  personality: { tono, detalle, riesgo },          // 0..100 (Formal→Cercano, Breve→Detallado, Prudente→Atrevido)
  autonomy: 'sugiere'|'avisa'|'solo',              // por defecto 'avisa'
  thinking: 'rapido'|'equilibrado'|'profundo',     // esfuerzo de razonamiento
  location: 'local'|'nube',
  tools: { correo, calendario, carpeta, hojas, chat, erp }, // 'none'|'lee'|'escribe'|'pide'
  helpers: [botId], delegateFreely: bool,
  channels: { colmena: true, correo: bool, chat: bool, movil: bool },
  // calculados por el servidor:
  status: 'trabaja'|'espera'|'libre'|'pausado'|'bloqueado',
  statusLabel: 'Trabaja'|'Te espera'|'Libre'|'En pausa'|'Bloqueado',
  activity: { verb: 'pensando'|'leyendo'|'escribiendo'|'programando'|'creando imagen'|'calculando'|'hablando con otro bot', missionId, detail } | null,
  waitingIn: number, missionCount: number, usesTotal: number }
```
Detalle `GET /api/bots/:id` → Bot + `{ soul, skills:[Skill], memories:[Memory], history:[Mission] }`.

### Mission (resumen)
```js
{ id, title, room: 'informe-q3', prompt, mode: 'solo'|'equipo'|'debate',
  botIds, conversation: bool,                 // true = chat 1:1 (pantalla Chat)
  status: 'queued'|'planning'|'awaiting_plan'|'running'|'waiting'|'paused'|'blocked'|'awaiting_choice'|'completed'|'cancelled',
  statusLabel, activityLine,                  // «Iris está maquetando la diapositiva 3 de 8»
  progress: { done, total }, pendingCount, questionCount,
  safety: 'preguntar'|'avisar', dueAt|null, automationId|null,
  createdAt, updatedAt, completedAt|null, error|null, chosenBotIds }
```
Detalle `GET /api/missions/:id`:
```js
Mission + {
  steps: [{ id, key, botId, kind: 'solo'|'plan'|'work'|'synthesis'|'proposal'|'critique'|'followup',
            title, status, text, startedAt, completedAt, words,
            activity: [{ verb, text, at }] }],
  messages: [{ id, role: 'user'|'assistant'|'system', botId, text, at,
               kind: 'message'|'plan'|'question'|'deliverable'|'activity',
               attachments: [{ name, size }], artifactId, approvalId,
               plan: { assignments: [{ botId, task }], approved: bool },
               summary: { reads, seconds } }],
  thread: [{ id, from: botId|'user', to: botId|null, text, at }],
  threadSummary: string|null,
  proposals: [{ botId, label, text, summary, critiques: [{ botId, text }] }], // debate
  files: [{ name, size }],
  artifacts: [ArtifactSummary]
}
```

### Approval (todo lo que espera tu OK; Bandeja)
```js
{ id, missionId, botId, status: 'pending'|'approved'|'denied'|'answered'|'executed',
  kind: 'question'|'send'|'permission'|'write'|'memory'|'plan'|'skill'|'soul',
  title,          // «Enviar el resumen semanal»
  summary,        // frase completa para la tarjeta
  context,        // «Vera · rutina de los jueves · hace 12 min»
  blocks: number, // pasos bloqueados
  options: [{ id, label, primary }],     // solo kind=question
  email: { to:[], cc:[], cco:[], subject, body, attachments:[] } | null, // kind=send
  canAlways: bool, createdAt, decidedAt, decidedBy: 'tú'|'regla', resolution }
```
Acciones:
- `POST /api/approvals/:id` `{ decision: 'approved'|'denied', always?: bool }`
- `POST /api/approvals/:id/answer` `{ optionId?, text? }` (preguntas)
- `PATCH /api/approvals/:id/email` `{ to, cc, cco, subject, body }` (Editar envío; vuelve a pendiente)

### Automation
```js
{ id, name, botId, prompt, enabled,
  trigger: { type: 'dia'|'semana'|'vez'|'correo'|'archivo'|'evento'|'sala'|'hoja', config: {...}, sentence },
  notify: 'siempre'|'resultado'|'fallo', needs: [{ tool, access }],
  state: 'scheduled'|'running'|'waiting'|'blocked'|'paused',
  nextRun|null, lastRun|null, lastStatus, subtitle,   // «Días laborables, 08:00 · Hoy ✓»
  createdAt }
```
`POST /api/automations`, `PATCH /api/automations/:id`, `DELETE /api/automations/:id`,
`POST /api/automations/:id/test`, `GET /api/automations/:id/runs` → `[{ at, missionId, title, status }]`,
`POST /api/automations/describe` `{ text }` → borrador `{ name, trigger, prompt, botId }` (Atlas).

### Suggestion (aprendizaje: lo que Atlas nota)
```js
{ id, kind: 'automation'|'always-approve', text, botId, cta, payload, createdAt }
```
`POST /api/suggestions/:id` `{ decision: 'accept'|'dismiss' }`.

### Skill
Resumen: `{ id, name, description, botId|null, status: 'pending'|'active'|'disabled', origin: 'learned'|'imported'|'shared', version, steps, uses, learnedFrom: 'tras 4 tareas parecidas', createdAt }`
`GET /api/skills/:id` → + `{ content, previous: { version, content }|null }`; `PATCH /api/skills/:id { status }`; `POST /api/skills { content, source, botId? }`.

### Memory
`{ id, text, botId|null, scope: 'bot'|'equipo', source: 'dijiste'|'dedujo'|'acuerdo'|'documento', sourceLabel, review: bool, missionId, createdAt }`
`POST /api/memories { text, botId?, scope }`, `PATCH /api/memories/:id { text?, review? }`, `DELETE /api/memories/:id`.

### Artifact
`{ id, missionId, botId, title, kind: 'document'|'table'|'slides'|'design'|'code'|'sheet', format: 'md'|'csv'|'svg'|'html'|'py'|..., status: 'final'|'borrador'|'en curso', version, room, createdAt }`
`GET /api/artifacts/:id` → + `{ content }`.

### Otros
- `Folder { id, path, label, botIds:[], access: 'lee'|'escribe' }` — Ajustes › Este ordenador. `POST/DELETE /api/folders`.
- `Person { id, name, email, role }` — Ajustes › Personas.
- `Connector { id: 'correo'|'calendario'|'carpeta'|'hojas'|'chat'|'video'|'crm'|'erp', name, connected, botCount }`.
- Búsqueda/paleta: `GET /api/search?q=` → `{ bots, missions, artifacts, files, messages }`.
- Bienvenida: `POST /api/onboarding { role }`.
- Pausa global: `POST /api/control { action: 'pause-all'|'resume-all' }`.
- Misiones: `POST /api/missions { prompt, mode, botIds?, conversationOf?, safety, attachments }`,
  `POST /api/missions/:id/messages { text, attachments? }`, `POST /api/missions/:id/control { action }`,
  `POST /api/missions/:id/plan { decision: 'approved'|'changes', note? }`,
  `POST /api/missions/:id/thread { text }` (pista para los bots),
  `POST /api/missions/:id/choose { botIds: [..] }` (1 = elegir, 2 = combinar),
  `POST /api/missions/:id/members { botId }` (Añadir a la conversación).
- Bots: `POST /api/bots`, `PATCH /api/bots/:id`, `POST /api/bots/:id/duplicate`, `POST /api/bots/prepare { description, audience, materials }`, `POST /api/bots/preview { draft, prompt }`, `PATCH /api/bots/:id/soul { soul }`.
- Ajustes: `PATCH /api/settings`, `POST /api/auth/start|cancel|logout`, `POST /api/auth/apikey { key }`, `POST /api/auth/local { baseUrl, model }`.

## 2. Tiempo real — `GET /api/events` (SSE)
- `{ type: 'changed', kinds: ['missions','approvals',…] }` → el cliente vuelve a pedir `/api/state` (debounce 150 ms) y el detalle abierto.
- `{ type: 'delta', mission, stepId, botId, text }` → texto en directo.
- `{ type: 'activity', mission, botId, verb, detail }` → estado del bot en directo.

## 3. Reglas de UI
- Las pantallas reproducen el marcado y estilos inline de `src/design/<Pantalla>.jsx` (generado de `design/*.dc.html`). No reinterpretar.
- Si un dato no existe todavía se muestra el estado vacío con el mismo estilo; nunca datos inventados.
- Rutas: ver `src/routes.jsx`.

## 4. Ampliaciones (openmuse · OpenClaw · Hermes)
- Aprobaciones: `revision` (hash del contenido), `expiresAt`, `external`, `computer`, `redLine`, `scopeLabel`. `POST /api/approvals/:id` y `/answer` exigen `revision` (409 si cambió); `POST /api/approvals/:id/renew`. Estado `expired` a los 30 min para acciones externas.
- Avisos: `/api/state.unread` y `notifications` (10 últimas); `GET /api/notifications`, `POST /api/notifications/read {ids|all}`; SSE `{type:'notify'}` → notificación de Windows vía Electron.
- Misión: `steps[].tools[]` (tarjeta por herramienta); `debateSummary`; `POST|GET /api/missions/:id/learn`.
- Disparador `web` (página cambia / contiene / precio baja); `GET /api/automations/web-preview?url=`.
- Aprendizaje: `GET /api/bots/:id/learning`, `PATCH /api/bots/:id/capabilities {web, carpetas, apps, ordenador}`, `GET /api/learning/skills`, `PATCH /api/skills/:id/curation`, `POST /api/learning/curate`, `GET|PUT /api/user-profile`, `POST /api/user-profile/condense`.
- Ordenador (`docs/COMPUTER.md`): `/api/state.computer.available`; `GET /api/computer/status|events|frame/:missionId|approval/:id|shot/:id`, `POST /api/computer/takeover {missionId, action}`, `GET|PUT /api/computer/apps`. SSE propio con fotogramas del navegador.

## 5. Ampliaciones (segunda ronda OpenMuse · OpenClaw)
- Expediente de la misión: herramientas `mission_brief` y `read_deliverable`; cada paso recibe el expediente y sus actualizaciones; las consultas entre bots reciben expediente y herramientas de solo lectura.
- Adjuntos: `{ name, content, encoding: 'utf8'|'base64', size }` (PDF, Word, Excel, PowerPoint, imágenes; 10 MB). Artefactos con archivo: `file`, `mime`; `GET /api/artifacts/:id/file[?download=1]`, `/meta`, `/pages/:n`; `POST /api/missions/:id/attachments`; `GET /api/core/capabilities`.
- Búsqueda web nativa (`web_search`), `create_image`, `pdf_fields`/`fill_pdf`, reintentos con espera y respaldo local; SSE `delta` con `reset:true`.
- Pregunta rápida: `POST /api/missions/:id/aside`, `…/aside/:asideId/share`, `DELETE …/aside/:asideId`.
- `/btw …` (o `/side …`, OpenClaw docs/tools/btw.md): pregunta al margen mientras el bot trabaja, en un chat o en Código. `POST /api/missions/:id/btw {question}` y `POST /api/code/tasks/:id/btw {question}` → `{ answer, botId, at }` (`server/btw.mjs`): una sola llamada sin herramientas, con el modelo del paso y la clave de caché lateral del bot (no toca la conexión del turno en curso), con una foto del chat (o de los últimos pasos de la tarea) y de lo que pasa ahora. No se guarda nada (ni mensaje, ni cola, ni `asides`, ni paso); `POST …/messages` y `…/queue` rechazan un texto «/btw …» con 400. La respuesta se ve como una nota sobre el cuadro de texto (`src/components/v2/BtwNotes.jsx`) que se cierra con ✕ o Esc y desaparece al salir de la pantalla.
- Encargos: `/api/standing-orders` (CRUD) y `POST /api/standing-orders/:id/automation`; recordatorios por tema: `/api/intents` (CRUD).
- Voz: `GET /api/voice/status`, `POST /api/voice/transcribe`; `bot.voice`.
- Olvidar: `GET /api/missions/:id/learned`, `POST /api/missions/:id/forget`, `GET /api/bots/:id/learned`. Resumen semanal: `POST /api/weekly-digest/:id/dismiss`.
- Objetivos: `/api/goals` (CRUD), `/milestones`, `/link`, `/plan`; herramienta `propose_goal` (crea sugerencia kind `goal`).
- `/api/state` añade `standingOrders`, `intents`, `weeklyDigest`, `voice`, `suggestions[].evidence`, `bots[].model`, `grants`, `computer`.

## 6. Chats largos, registro de trabajo y cola (ideas de T3 Code)
- Historial por páginas (`server/history.mjs`, `src/lib/history.js`): `GET /api/missions/:id` trae en un chat 1:1 sus últimos **75** mensajes de primer nivel (con sus respuestas en hilo y sus líneas `progress`) y solo los `steps` que esos mensajes necesitan, más todo paso sin terminar; las salas, los últimos 120 y todos los pasos. Añade `olderCount` y `cursor` (el id del mensaje más antiguo mostrado). `GET /api/missions/:id/history?antes=<cursor>&limite=<n≤200>` devuelve `{ messages, steps, olderCount, cursor }` de la página anterior (404 si el cursor no existe). `?mensajes=todos` sigue trayendo todo (exportar).
- La conversación es una lista virtual (`src/components/v2/chat/Timeline.jsx`, `@tanstack/react-virtual` 3.14.13, `anchorTo: "end"`): abre al final, sigue lo nuevo si estás al final, carga la página anterior al acercarte arriba y mantiene la fila que ves al anteponerla.
- SSE: `delta` y `activity` salen en ventanas de ~50 ms (`server/live-coalescer.mjs`): un `delta` por paso y ventana con el texto unido; de `activity`, solo el último estado por bot. Un `reset`, un `activity` sin verbo, `step_done`, `notify` y `completed` envían antes lo pendiente y salen al momento.
- Registro de trabajo (`src/lib/worklog.js` + `src/components/v2/chat/WorkLog.jsx`): las herramientas seguidas se leen en una frase («Ha leído 5 correos y 2 páginas web, buscado en la web y editado 2 archivos»); al desplegar, cada paso; al desplegar un paso, su detalle. La tarjeta de app lleva `count` (cuántos elementos devolvió una lectura).
- Salida en vivo de comandos (`server/command-output.mjs`): `run_command` escribe su salida en un «hub» con una cola acotada por comando; solo la fila desplegada la pide: `GET /api/commands/output?step=<stepId>&call=<callId>` (SSE) → `{type:'replace', text}`, luego `{type:'append', text}` cada ~100 ms y `{type:'done', exitCode}`.
- Cola de mensajes (`server/queue.mjs`): vive en la misión (`queue: [{ id, text, at }]`, `queuePaused: string|null` en el resumen) y sobrevive a un reinicio; el servidor envía el primero cuando el bot acaba (`status: completed`), de uno en uno; un envío rechazado lo devuelve el primero y pausa la cola. `POST /api/missions/:id/queue {text}`, `PATCH …/queue/:item {text?, before?: id|null}`, `DELETE …/queue/:item`, `POST …/queue/:item/now` («Pasárselo ya»: lo envía con `mode: 'steer'`), `POST …/queue/resume`.
- Cuadro de texto: pegar ≥ 32 KB lo adjunta como `pegado-….txt` (base64 por encima de 200 000 caracteres); ↑ en el cuadro vacío recorre lo que enviaste en ese chat (guardado en este equipo, `colmena:prompts`; nada en incógnito); Ctrl+S guarda el borrador en «Guardados para después» (`colmena:stash`); «Citar en el mensaje» al seleccionar texto de una respuesta.
- Medir: `COLMENA_DATA_DIR=.local/qa-data node scripts/seed-long-chat.mjs 400`, configuración `qa-prod` (puerto 4323) y `node scripts/measure-long-chat.mjs http://127.0.0.1:4323`.

## 7. Deshacer lo que hizo el bot (puntos de restauración, idea de T3 Code)
- `server/checkpoints.mjs`: antes de la primera herramienta que puede cambiar archivos en un turno (un paso: `write_file`, `create_deliverable`, presentaciones, documentos, hojas, `fill_pdf`, `create_image`, `browser_download`, `run_command`, `project_*` salvo `project_files`/`project_preview`), Colmena guarda un punto de restauración de la carpeta de la misión (`workspaces/<missionId>`, proyectos incluidos) y, si la llamada lleva `folderId` de una carpeta compartida con permiso `escribe`, de esa carpeta. Al terminar la misión (`run()` libre) guarda el segundo punto y la diferencia: creados, editados y borrados. Un turno sin cambios no deja punto.
- Almacén: git oculto propio por carpeta en `<datos>/checkpoints/<clave>/git` (`GIT_DIR` + `GIT_WORK_TREE`, índice propio, sin configuración global ni del sistema, `info/attributes` que desactiva conversiones, refs `refs/colmena/<misión>/<punto>/before|after`); nunca lee ni escribe el `.git` de la persona y los repositorios anidados quedan fuera. Sin git: copia por contenido (`copy/objects` + `copy/manifests`). Fuera: `node_modules`, `dist`, `build`, `.cache`, `.vite`, `.next`, `__pycache__`, `.venv`, `.git`… (y lo que diga el `.gitignore` de la carpeta, con git), archivos de más de 25 MB; una carpeta con más de 10 000 archivos o 400 MB no tiene punto (`skipped`). La papelera de proyectos (`.papelera/`) se guarda pero no se lista.
- Limpieza: últimos 30 turnos con cambios y nunca más de 30 días por misión; borrar la misión borra sus puntos y su almacén (`purgeMission`).
- `GET /api/missions/:id` añade `checkpoints: [{ id, stepId, botId, at, created, edited, deleted, total, folders, skipped, restoredAt, restoredMode }]` (de más antiguo a más nuevo).
- `GET /api/missions/:id/checkpoints/:cp?modo=turno|punto` → `{ mode, files: [{ path, change, folder, later }], skipped, later, turns, busy, deliverables, outside }`: `change` es lo que deshacer hace (desde ese punto), `later` = el archivo cambió después (o fuera de esas respuestas) y ese cambio también se pierde, `busy` = por qué no se puede ahora.
- `POST /api/missions/:id/checkpoints/:cp/restore { mode: 'turn'|'point' }` → `{ restored, failed, deliverables }`. 409 si el bot trabaja en esa misión o si otro chat en marcha usa la carpeta compartida afectada. Los entregables cuyo archivo desaparece salen de la Biblioteca y del chat. Deja en el hilo una línea `kind: 'activity'` («Has deshecho los cambios de Bruno en 3 archivos (su respuesta de las 18:41).») y el siguiente turno de cada bot recibe una vez un «Aviso de Colmena» con cómo quedan los archivos.
- Interfaz: `src/components/v2/chat/UndoChanges.jsx` bajo la última respuesta de cada turno con cambios (chats y salas): «Deshacer cambios · N archivos» → vista breve con los archivos, «Solo esta respuesta» / «Volver a este punto», la frase de límites («Solo vuelven atrás los archivos de este ordenador…») y la espera de 10 s con «No, déjalo» (`src/lib/undoable.js`).
- QA: `node .local/seed-undo.mjs` y la configuración `qa-undo` (puerto 4332).

## 8. Código (proyectos y tareas con Claude Code; ideas de T3 Code y OpenClaw)
- Lugar propio en la barra («Código», `/codigo` y `/codigo/:task`, `src/screens/CodigoV2.jsx`, tablero `design/V2Codigo.dc.html`). Servidor en `server/code/`: `service.mjs` (proyectos, tareas, turnos), `claude.mjs` (motor), `policy.mjs` (permisos y líneas rojas), `git.mjs` (worktrees y puntos de restauración), `ports.mjs` (escáner de puertos), `routes.mjs`.
- Registros: `codeProjects` `{ id, name, root, repo, top, base, allow: [regla] }`, `codeTasks` `{ id, projectId, title, botId:'bruno', engine:'claude-code', model, effort, access:'project'|'ask'|'full', isolated, cwd, branch, base, baseCommit, worktree, baseSnap, status:'idle'|'working'|'waiting'|'error', turns:[{ n, userItemId, startSnap, endSnap, add, del, files, sessionAt }], queue, session:{ id, started, forkAt }, usage, limit, merged }`, `codeItems` (la línea de tiempo) `{ id, taskId, seq, kind:'user'|'text'|'tool'|'turn'|'ask'|'notice'|'error', … }`. No pasan por `/api/events`: van por `GET /api/code/events` (SSE: `delta` en ventanas de 50 ms, `item`, `task`, `projects`, `reload`, `attention`).
- Motor: el Claude Code de este ordenador (`claude --print --input-format stream-json --output-format stream-json --permission-prompt-tool stdio --setting-sources project,local --tools …`), un proceso por tarea que vive entre turnos (30 min sin uso → se cierra con sus servidores). Cada herramienta pasa por Colmena (gancho `PreToolUse` + `can_use_tool`, una sola decisión por `tool_use_id`). Sesión persistente: `--session-id`/`--resume`; «Editar desde aquí» = `--resume-session-at <respuesta anterior> --fork-session`.
- Copia aparte: si la carpeta es un repositorio con commits, cada tarea va en `git worktree add -b colmena/<título>-<id> <datos>/code/worktrees/<proyecto>/<tarea> HEAD`. Sin git (o sin commits) trabaja en la carpeta. Puntos de restauración antes y después de cada turno en un git oculto propio por tarea (`<datos>/code/snapshots/<tarea>`, `GitBackend` de checkpoints.mjs, respeta el `.gitignore`).
- Permisos (`policy.mjs`): «Su copia del proyecto» (`project`, por defecto) todo libre dentro de la carpeta de la tarea; «Pregunta antes de cada cambio» (`ask`); «Todo el ordenador» (`full`, edita fuera). Líneas rojas siempre: `git push`, publicar (npm publish, gh pr/release, vercel/netlify/firebase/… deploy, docker push), enviar datos (curl/iwr con POST o datos), borrar/escribir/mover fuera del proyecto, instalar para todo el ordenador (`-g`, `--user`), cambiar Windows (winget, reg, schtasks…), conectarse a otro equipo, cerrar programas por su nombre. Solo `git push` admite «Siempre en este proyecto» (`project.allow`).
- Rutas: `GET /api/code` → `{ projects:[…con tasks], models, efforts, access }`; `POST /api/code/projects { folder } | { clone: url https } | { name }`; `DELETE /api/code/projects/:id` (solo la quita de la lista); `POST /api/code/tasks { projectId, text, model?, effort?, access?, isolated? }`; `GET|PATCH|DELETE /api/code/tasks/:id`; `POST …/messages { text, when:'queue'|'steer' }`; `DELETE …/queue/:item`; `POST …/stop`; `POST …/asks/:ask { decision:'allow'|'always'|'deny' } | { answers }`; `GET …/diff?turn=n` (sin `turn`: toda la tarea) → `{ files:[{ path, status, add, del, binary, patch }], add, del, truncated }`; `POST …/restore { turn } | { undo }`; `POST …/edit-from { item }` → `{ text }`; `GET …/ports` → `{ ports:[{ port, pid, name, url }] }`; `POST …/save { to:'branch'|'base' }` (commit con mensaje de Claude Code; `base` = commit + merge `--no-ff` en la carpeta, 409 si esta no está limpia en su rama base).
- Vista previa: iframe a `http://127.0.0.1:<puerto>` (CSP de producción con `frame-src` de bucle local); los puertos son los de procesos descendientes del Claude Code de la tarea o cuya línea de órdenes incluye su carpeta (`netstat -ano` + `Win32_Process`, caché 2,5 s).
- Pruebas: `tests/code.test.mjs` con `tests/fixtures/fake-claude-code.mjs`. QA: configuración `qa-code` (puerto 4334, `COLMENA_CODE_DEBUG=1` escribe cada mensaje del motor en el registro del servidor).

### 8.1 Fase 2: Codex, modo plan, subir y PR, terminal
- Motores: `codeTasks.engine` es `claude-code` o `codex` (se elige al crear la tarea; el modelo y el esfuerzo se cambian luego). Los dos dan los mismos eventos al servicio (`onEvent`: `session`, `delta`, `text`, `tool`, `toolDone`, `child`, `usage {used, window}`, `limit`, `plan`, `mark`, `done {error, interrupted}`).
- Codex (`server/code/codex.mjs`): `node …/@openai/codex/bin/codex.js app-server -c mcp_servers={}` (JSON-RPC por stdio, `experimentalApi`). `thread/start|resume` con `approvalPolicy: "untrusted"` y el sandbox del acceso (`project` → `workspace-write` con red, `ask` → `read-only`, `full` → `danger-full-access`), `developerInstructions` = las de Bruno. `turn/start` con `collaborationMode {mode: plan|default}`; `turn/steer` para «Pasárselo ya»; `turn/interrupt`; «Editar desde aquí» = `thread/rollback {numTurns}` al reanudar. Las peticiones `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval` y `item/tool/requestUserInput` pasan por la misma política y líneas rojas (la orden se lee sin el envoltorio `powershell.exe -Command`). Modelos: `model/list` de tu cuenta, una vez (`GET /api/code` → `engines: [{ id, label, available, models }]`).
- Modo plan: `POST …/messages` y `POST /api/code/tasks` aceptan `mode: 'plan'`. Claude Code pasa a su `permissionMode` `plan` (`set_permission_mode`) y su `ExitPlanMode` se recoge como plan y se niega («Colmena ha recogido tu plan…»); Codex usa su modo de colaboración `plan`. El plan es un elemento `kind: 'plan' {text, status: open|implemented|moved|refined}` y la tarea queda `status: 'planned'`. `POST /api/code/tasks/:id/plans/:item { action: 'implement'|'new'|'refine', text? }`: implementar en el mismo hilo, en una tarea nueva (con su copia; empieza por «Implementa este plan:» + el plan) o refinar (nuevo turno en modo plan con tu texto).
- Guardar: `POST …/save { to: 'branch'|'base'|'push'|'pr' }`. `push` = commit + `git push -u origin HEAD:refs/heads/<rama>` (pulsar el botón es el OK de la persona); errores claros sin `origin`, sin credenciales o con la rama remota por delante. `pr` = push + título y descripción en inglés escritos por una llamada rápida (Claude Code Haiku, o `codex exec --ephemeral -s read-only` si la tarea es de Codex) y devuelve `url` de `https://github.com/<repo>/compare/<base>...<rama>?expand=1&title=…&body=…` (sin `gh`); solo GitHub. Las tareas sin copia aparte también pueden guardar, subir y abrir PR en la rama actual.
- Procesos: al acabar cada turno se recuerdan los descendientes del motor (`descendants`, PID + línea de órdenes); cuentan para la vista previa aunque su padre haya salido y se cierran con la tarea (`stopFamily` solo mata un PID si sigue teniendo la misma línea de órdenes).
- Terminal (`server/code/terminal.mjs`, `node-pty` 1.1.0, `@xterm/xterm` 6.0.0 + `@xterm/addon-fit` 0.11.0): PowerShell en la carpeta de la tarea, hasta 6 por tarea, 512 KB de historial en memoria y en `<datos>/code/terminals/<tarea>/<id>.log` (250 ms tras cada cambio); al volver, el historial y «— sesión anterior —». Rutas: `GET …/terminals` → `{ terminals, scripts }` (scripts de `package.json`), `POST …/terminals { id?, script?, cols, rows }`, `GET …/terminals/:term/stream` (SSE: `replay`, `data` en ventanas de 16 ms, `exit`), `POST …/terminals/:term/input { data }`, `POST …/terminals/:term/resize { cols, rows }`, `DELETE …/terminals/:term`. Sus procesos cuentan para la vista previa y se cierran con la tarea.
- Pruebas: `tests/code-phase2.test.mjs` con `tests/fixtures/fake-codex.mjs` (y el modo plan del falso Claude Code).
- Vista previa: cada puerto lleva `contentType` y `source` (`probePage`: una página HTML enviada como `text/plain` enseñaría su código); la pestaña lo dice con «Pedir a Bruno que lo arregle» (manda el mensaje a la cola) y Bruno tiene la instrucción de comprobarlo.
- Panel derecho: se ensancha arrastrando su borde izquierdo (`usePanelWidth("codigo")`, doble clic = tamaño normal) o con «Ampliar el panel» (ocupa casi todo; la lista de proyectos se oculta y el hilo se queda en 520 px, con la cabecera compacta por debajo de 660 px). Se recuerda en este equipo (`colmena:code-panel-wide`).

### 8.2 Fase 3: cuadro completo, varios motores, scripts, atajos, compactar y OpenCode
- Cuadro (`src/components/v2/code/Extras.jsx`, `triggerAt` en `model.js`): `/` al empezar el mensaje abre comandos de Colmena (`/plan`, `/construir`, `/compactar`, `/parar`, `/nueva`, `/atajos`) y los del motor (Claude Code los da al iniciarse); `$` lista las habilidades (`GET /api/code/skills?task=|project=`: carpetas `SKILL.md` de `.claude/skills` y `.agents/skills` del proyecto, `~/.claude/skills` y `~/.codex/skills`; gana la más cercana) y el servidor las mete en el mensaje para cualquier motor (`expandSkills`, la línea de tiempo guarda tus palabras); `@` busca archivos de la tarea (`GET /api/code/tasks/:id/files?q=` o `…/projects/:id/files`, `git ls-files -co --exclude-standard`, coincidencia difusa). Adjuntos: clip, pegar o soltar → `POST /api/code/attachments { name, data base64 }` (≤ 20 MB, en `<datos>/code/attachments/<id>/`, ruta propia con `codeUploadParser` de 28 MB) → `attachments: [{ path }]` en `POST /api/code/tasks` y `…/messages`; solo se aceptan rutas de esa carpeta y el motor recibe la lista de rutas.
- Compactar: `POST /api/code/tasks/:id/compact` (también el anillo de contexto y `/compactar`): un turno con nota «Compactando…»; Claude Code recibe `/compact`, Codex `thread/compact/start` (acaba con `thread/compacted`), OpenCode `POST /session/:id/summarize`.
- Límites: la línea bajo el cuadro avisa desde el 75 % del límite del motor (o al llegar) con cuándo se renueva (`task.limit`).
- Varios a la vez (inicio): «Probar con varios a la vez» elige hasta 4 motor · modelo; se crea una tarea por cada uno (`label` añade «· Motor · Modelo» al título), cada una en su copia.
- Scripts: `colmena.json` (o `t3.json` de T3 Code) `{ "scripts": [{ "name", "command", "onCreate" | "runOnWorktreeCreate" }] }` más los de `package.json`; la copia de la tarea manda sobre la carpeta del proyecto. «+ Script» los guarda con `POST /api/code/projects/:id/scripts`. Los `onCreate` se lanzan en una terminal al crear la tarea (hasta 3) y Bruno lo sabe para no repetirlos.
- Atajos (`Shortcuts.jsx`, `GET|PUT /api/code/keybindings`, registro `codeSettings/keybindings`): nueva tarea Ctrl+N, escribir Ctrl+L, Plan Ctrl+⇧M, parar Ctrl+., compactar Ctrl+⇧C, panel Ctrl+J, ampliar Ctrl+⇧J, pestañas Ctrl+1/2/3, nueva terminal Ctrl+⇧T, guardar Ctrl+⇧S, atajos F1. Cada uno se cambia pulsando la combinación (con Ctrl o Alt; las teclas F valen solas); si ya era de otra acción, se le quita. Ctrl+K muestra tareas de código, «Nueva tarea de código…» y, dentro de Código, «Atajos de Código».
- OpenCode (`server/code/opencode.mjs`): motor `opencode`, `opencode-ai@1.19.3` instalado solo para Colmena en `<datos>/code/engines/opencode` al pulsar «Instalar» (`POST /api/code/engines/opencode/install`). Un `opencode serve --port <libre> --hostname 127.0.0.1 --pure` por tarea con `OPENCODE_SERVER_PASSWORD` aleatoria (Basic `opencode:<clave>`) y, para modelos `opencode-go/…`, tu clave de OpenCode Go en `OPENCODE_API_KEY` (solo en la memoria del proceso). Sesión con reglas de permiso «preguntar» salvo lecturas, búsquedas, web y preguntas; cada `permission.asked` pasa por la política (`permissionToTool`). Turnos `prompt_async` con agente `build` o `plan`, eventos de `/event` (texto, herramientas, `step-finish` → uso, `session.status idle` → fin), `abort`, `summarize`, `fork` para «Editar desde aquí». Modelos: con tu clave de Go, DeepSeek V4.1 Flash (por defecto), Kimi K3, GLM 5.3 Flash; siempre, los gratis DeepSeek V4.1 Flash y Muse Spark 1.3.
- Pruebas: `tests/code-phase3.test.mjs` con `tests/fixtures/fake-opencode.mjs`.

### 8.3 Bloque A: avisos, lista por estado, copias listas, `/goal` y contexto de la terminal
- Avisos: `CodeService` recibe el `notifier` de Colmena (`server/notifications.mjs`). Avisa al terminar un turno («done»: «Bruno ha terminado «…»»), al pedir OK o preguntar, con un plan, o con un objetivo bloqueado («needs»), y si se atasca («failed»). Usa el sonido y el aviso de Windows de Ajustes › Avisos (`url` `/codigo/<tarea>`, `extra.codeTask`, un aviso sin leer por tarea y tipo). No avisa de la tarea que tienes delante con la ventana activa (`POST /api/code/watch { task, focused }`, cada 45 s y al cambiar el foco).
- Lista por estado (`ProjectList.jsx`, `groupOf`): «Por estado» (por defecto) agrupa «Te espera», «Atascadas», «Trabajando», «Para revisar», «Guardadas» y «Nuevas»; «Por proyecto» es la lista de antes. Se recuerda en `localStorage` `colmena:code-list-view`.
- Copias que arrancan solas: `.worktreeinclude` (patrones como `.gitignore`) copia a la copia nueva los archivos ignorados que coincidan (hasta 400 archivos y 50 MB; `copyIncluded` en `git.mjs`). Los scripts `onCreate` escriben al terminar `[colmena:listo]` o `[colmena:fallo]` y la nota «Preparando la copia…» pasa a «Copia lista» o a «falló».
- Guardar en main: tras el merge, la copia se limpia (se cierran su motor y terminales, `git worktree remove`, su rama ya fusionada se borra) y su último commit queda en `refs/colmena/saved/<tarea>` 30 días (registro `codeSaved`, `task.saved`). Escribir, «Volver aquí», «Editar desde aquí», guardar o abrir una terminal la recupera tal cual (`recover`); pasados 30 días se borra la ref (`pruneSaved` al arrancar) y la tarea queda de solo lectura.
- `/goal <qué es estar hecho>` (`POST /api/code/tasks/:id/goal { action: set|pause|resume|clear|complete, text }`): `task.goal { text, status: active|paused|complete|blocked|limited, turns, max: 12, note }`. Cada turno acaba con «[objetivo: cumplido | sigue | bloqueado — motivo]» (se quita de lo que ves); con «sigue» Colmena lanza el siguiente turno sola, como mucho 12. Parar lo pausa. La fila encima del cuadro enseña el objetivo, la vuelta y Pausar/Reanudar/Quitar; `/goal pausa`, `/goal sigue`, `/goal quita`.
- Contexto en el mensaje: seleccionar texto en la terminal → «Enviar a Bruno» lo pone como chip en el cuadro (`addContext`, evento `colmena:code-context`). Los mensajes llevan `contexts: [{ kind: terminal|diff|preview, label, text, note, file, lines, url, image }]`; el motor los recibe tras tus palabras (`contextBlock`) y la burbuja los enseña como chips.
- OpenCode: en modo Plan su respuesta llega como tarjeta de plan (evento `plan`); el esfuerzo elige la variante del modelo (`pickVariant`, `variant` en `prompt_async`). Si se cierra, dice «OpenCode se cerró» (`ENGINE_LABEL`).
- Vista previa en macOS y Linux: el escáner de puertos usa `lsof -nP -iTCP -sTCP:LISTEN -F pn` y `ps -axww -o pid=,ppid=,command=` (`parseLsof`, `parsePs`); parar la familia del motor usa `SIGTERM` por PID tras comprobar su línea de comando.
- Pruebas: `tests/code-phase4.test.mjs`.

### 8.4 Bloque B: comentar el diff, revisión antes de guardar, ponerse al día y la vista previa de Bruno
- Comentar líneas del diff (`Changes.jsx`, `diffContext` en `model.js`): pulsa el número de una línea (Mayús: varias) y escribe; entra en el cuadro como chip `kind: "diff"` con archivo, líneas, el texto de esas líneas con su signo y tu nota.
- Revisión (`POST /api/code/tasks/:id/review`, OpenClaw autoreview): un revisor sin herramientas (Claude Code `--print` con Sonnet 5.5, o Codex `exec` de solo lectura) lee el diff de toda la tarea y responde hallazgos P0–P3 en JSON; queda un elemento `review` en la línea de tiempo (`task.review { turns, serious, total }`). «Guardar en main» revisa primero si no hay revisión del último turno; con P0–P1 se para y ofrece «Guardar igualmente». Cada hallazgo va a Bruno como chip («Pasar a Bruno») o todos en un mensaje («Que Bruno lo arregle todo»).
- Ponerse al día (`POST /api/code/tasks/:id/catch-up`, también en el menú de guardar): guarda lo pendiente y hace `git merge <base>` en la copia. Sin conflictos, listo. Con conflictos, `task.merging { base, files }` y un turno de Bruno para resolverlos en su copia sin hacer commit; al acabar, si no quedan marcas, Colmena cierra el merge. «Guardar en main» comprueba antes que la base es antecesora de la rama (`git merge-base --is-ancestor`); si no, se pone al día primero y, con conflictos, responde `{ resolving, files }` y guarda cuando Bruno acaba, sin conflictos.
- La vista previa de Bruno: el navegador de escritorio de Colmena (operación `preview` de `desktop/browser.cjs`, misión `code:<tarea>`) abre el servidor de la tarea y devuelve errores de consola, cargas fallidas, texto, elementos con ref y una captura (`<datos>/code/tmp/vista-<tarea>.jpg`). Bruno lo usa con `node server/code/preview-cli.mjs ver [ruta|puerto] · pulsa <ref> · escribe <ref> <texto> · tecla <tecla>` (`COLMENA_CODE_API` y `COLMENA_CODE_TASK` en el entorno del motor; `POST …/preview/check` y `…/preview/act`). Tras cada turno que cambia archivos, Colmena mira la página y deja la línea «Revisó la vista previa · N errores» (`task.previewCheck`). El pie de la vista previa lo enseña, con «Pasar a Bruno» y «Revisar ahora». Al borrar o limpiar la tarea se cierra su pestaña (`closeMission`, `previewRevoke`). Sin Colmena de escritorio no está disponible.
- Anotar la vista previa: «Anotar», arrastra una zona y escribe; en escritorio se captura esa zona (`colmenaWindow.captureRect` → `colmena-capture-rect` → `capturePage`) y se guarda como adjunto; el chip `kind: "preview"` lleva la nota, la zona, la dirección y la captura (solo se acepta si es un adjunto de Colmena).
- Pruebas: `tests/code-phase5.test.mjs`.

### 8.5 Bloque C: permisos finos, comparar motores, seguir la PR y detalles del diff
- Permisos (`policy.mjs decide`, OpenClaw exec approvals): además de «Permitir» y «Siempre en este proyecto» (git push), cada pregunta ofrece «En esta tarea» (`task.allow`: la línea roja o el tipo de paso —`edit`, `shell`, una herramienta— ya no pregunta en esa tarea) y, para órdenes, «Siempre aquí» (`project.commands`: esa orden exacta, con los espacios normalizados por `commandKey`, ya no pregunta en ese proyecto). Cambiar el sistema y borrar fuera del proyecto (`ONCE_ONLY`) preguntan siempre. `POST …/asks/:ask { decision: allow | task | here | always | deny }`.
- Comparar (`/codigo/comparar/<grupo>`, `Compare.jsx`): las tareas creadas con «Probar con varios a la vez» comparten `group` y `label`. La vista enseña por motor lo que cambió (archivos, +/−), lo último que dijo Bruno y sus tests: «Probar todos» ejecuta el script `test` del proyecto en cada copia, una tras otra (`POST /api/code/compare/:grupo/tests`, `task.tests { status: queued|running|passed|failed, durationMs }`). «Elegir este» lo guarda en la base; después se pueden borrar las demás.
- Seguir la PR (`gh`): tras «Guardar y subir» o «…abrir PR» a GitHub, si `gh` está instalado y con sesión, Colmena mira cada 2 minutos `gh pr view <rama>` (`task.pr { number, url, state, mergeable, checks, watching }`, chip «PR #n · CI falla/pasa» en la cabecera). Si falla el CI (con `gh run view --log-failed`), hay conflictos o comentan, avisa y despierta a Bruno una vez por cada cosa (línea «Bruno se pone con la PR…», el mensaje completo en su título). Subir de nuevo sigue pidiendo OK. Fusionada o cerrada, deja de seguirla. Sin `gh` o sin sesión, lo explica. `POST /api/code/tasks/:id/pr { watch }`.
- Diff: «Lado a lado» (`sideBySide` en `model.js`, recordado en `colmena:code-diff-split`), «Deshacer este archivo» (dos clics; `POST …/revert-file { path, turn }` lo vuelve como al empezar ese turno o la tarea, con «Deshacer») y «Abrir en el editor» en la línea (`POST …/open-editor { path, line }`: `code -g`, `cursor -g` o `windsurf -g`; si no hay ninguno, el programa de ese tipo de archivo), también desde el comentario de unas líneas.
- Pruebas: `tests/code-phase6.test.mjs` con `tests/fixtures/fake-gh.mjs`.

### 8.6 Archivar y posponer tareas; borrar copias sin seguir junctions
- Archivar (T3 Code «settle»): el menú «…» de cada tarea en la lista tiene Fijar arriba, Posponer, Archivar o Desarchivar, «Archivar sola» (`task.autoArchive`) y Borrar. Archivar no borra nada: la tarea pasa a la estantería «Archivadas» (`task.archived { at, by: manual|saved|pr|idle }`), se cierra su motor, sus preguntas pendientes se retiran sin respuesta y se quita de fijadas. En su copia (nunca en la carpeta del proyecto ni si la copia ya se limpió) se ejecutan los scripts de cierre (`onSettle` en colmena.json, `runOnSettle` en t3.json; casilla «Al archivar» en «+ Script»). Su terminal se cierra si acaban bien y se queda si fallan. Escribirle la devuelve a la lista. «Desarchivar» la devuelve sin que se vuelva a archivar sola hasta que le escribas (`holdAuto`). `POST /api/code/tasks/:id/archive { archived }`.
- Archivado automático (`ARCHIVE_DEFAULTS`, Ajustes › Bots y autonomía › Tareas de Código, `GET|PUT /api/code/archive-settings`): al guardarla en main (`onSave`), al fusionarse o cerrarse su PR (`onPr`) y tras N días sin actividad (`idleDays`, 3 por defecto; 0 = nunca; cuentan tus mensajes y el final de cada turno, `activeAt`), con «Conservar las que tienen una PR abierta» (`keepWithPr`). Cada proyecto puede cambiar los días y lo de la PR desde su «…» (`project.archive`, `PATCH /api/code/projects/:id`). Nunca se archiva sola si está fijada, tiene «Archivar sola» desactivado, está pospuesta, trabaja, te espera (pregunta, plan, conflicto, objetivo bloqueado), tiene mensajes en cola o trabajo en segundo plano (objetivo en marcha, tests, script de preparación o de cierre) (`holdsArchive`). Se revisa cada 10 minutos y al arrancar.
- Posponer (T3 Code «snooze»): «Más tarde hoy» (18:00, o en 3 horas si ya es tarde), «Mañana» (9:00), «La semana que viene» (lunes 9:00) o «Elegir día y hora…» (`snoozePresets`, `task.snoozed { until }`, `POST /api/code/tasks/:id/snooze { until | null }`). Sigue trabajando escondida en «Pospuestas» y no avisa al acabar; vuelve antes solo si pregunta o pide OK, si falla o si le escribes (`wokeBy`). Cada 30 s despiertan las que llegan a su hora.
- Lista: «Fijadas» arriba y las estanterías «Pospuestas» y «Archivadas» al final, plegables (`colmena:code-shelves`). Archivar, posponer y quitar de fijadas enseñan el «Deshacer» de 5 s (`reversible` de `src/lib/undoToast.js`); borrar sigue con `later`.
- Borrar copias (`removeLinkedWorktree` en `git.mjs`, T3 Code fa42465f): Git para Windows anterior a 2.54 (este PC tiene 2.50.1) sigue los junctions de NTFS en `git worktree remove` y borra lo que hay detrás. En Windows Colmena comprueba que es una copia registrada de ese repositorio y que no está bloqueada, borra la carpeta con `rm` de Node (deshace los junctions sin seguirlos), devuelve el `.git` si el borrado falla a medias y luego Git olvida la copia (`worktree remove --force --force` y `worktree prune`). Fuera de Windows lo hace Git como antes.
- Pruebas: `tests/code-phase7.test.mjs` (con un junction real dentro de la copia).

## 9. Ajustes por secciones, Uso y Diagnóstico (ideas de T3 Code y OpenClaw)

- Secciones (`src/components/v2/settings/sections.js`, tablero `design/V2AjustesSecciones.dc.html`): `/ajustes/<sección>` con `cuenta`, `inteligencia`, `autonomia`, `apps`, `avisos`, `privacidad`, `uso`, `diagnostico`, `acerca`; cada ajuste tiene ancla (`/ajustes/avisos#horario`), que al abrirla se desplaza hasta él y lo resalta un momento. Las páginas de detalle (`/ajustes/ia`, `ia-v1`, `permisos`, `conexiones`, `ordenador`, `personas`, `seguridad`) viven dentro de su sección (`PARENT`); `/ajustes/limites` es Uso y `/ajustes/espacio` es Tu cuenta (`ALIAS`). Buscador con «/» o Ctrl+F (orden de T3: título exacto > empieza > contiene > todas las palabras > palabras afines). En ventana estrecha (≤ 940 px) la lista y la sección se turnan.
- `GET /api/usage/overview?days=7|30|90` (`server/usage-routes.mjs`, solo lee los registros `usage`): `{ from, to, days, total: { tokens, input, cached, output, reasoning, calls, cachePercent }, perDay: [{ date, tokens, input, cached, output }], bots: [{ botId, …totales, cachePercent }], chats: [{ missionId, title, kind: chat|room|gone, botIds, incognito, …totales }], models, purposes: [{ purpose: step|side, … }], month: { monthTokens, limitTokens, percent }, plans: { openai: { primary, secondary } | null, engines: [{ id, label, connected, detail, limit, resting }] } }`. Un chat de incógnito sale como «Chat de incógnito», sin su título. `cachePercent` = cached / input (null sin entrada medida).
- `GET /api/diagnostics` (`server/diagnostics.mjs`): `{ at, ms, checks: [{ id, group: ia|codigo|datos|servidor|apps, title, status: ok|warn|fail|off, text, fix?, to?, command? }], summary }`. Cuentas de IA (conectada, límite y cuándo se renueva, sesión de ChatGPT con permiso del plan, `claude auth status` si Claude va por Claude Code, respaldo sin elegir), motores de código (Claude Code instalado, versión ≥ `CLI_MIN_VERSION` y sesión; Codex y `codex login status`; OpenCode instalado), base de datos (tamaño, WAL > 64 MB, `PRAGMA quick_check(20)` en un hilo aparte con su propia conexión de solo lectura; nunca VACUUM), disco libre (< 5 GB aviso, < 1 GB falla), bloqueos del servidor (`app.locals.stalls`, `server/stalls.mjs`) y conexiones de apps (Composio y MCP). Cada comprobación tiene su plazo (12 s) y un grupo lento no frena a los demás; dos clics seguidos comparten la misma comprobación. Las actualizaciones se leen en la app (`useUpdates`).
- Pruebas: `tests/settings-usage-diagnostics.test.mjs`. Datos de uso para QA: `COLMENA_DATA_DIR=.local/qa-data node scripts/seed-usage.mjs`.

## 10. «Deshacer» de 5 segundos (idea de T3 Code)

- `src/lib/undoToast.js` + `src/components/v2/UndoToasts.jsx`: `later()` espera 5 s antes de llamar al servidor (borrar) y mientras tanto quita la cosa de las listas (claves `tipo:id`, filtradas en el `store` y en las pantallas con listas propias); `reversible()` hace el cambio ya (archivar, posponer, pausar el equipo) y «Deshacer» llama al contrario. Ctrl+Z fuera de un campo de texto deshace el último aviso. Sin pantallas de confirmación.

## 11. Paleta Ctrl+K (idea de T3 Code)

- `src/screens/CommandPalette.jsx` + `src/lib/palette.js`: un solo buscador de chats, salas, mensajes (`/api/search`), entregables y archivos, bots, tareas de Código (`/api/code`) y ajustes (`searchSettings`), agrupados por tipo; la primera fila sigue siendo «Pedir». Con «>» solo acciones (nuevo chat, nueva tarea de código, nueva rutina, nuevo bot, «Ir a…», «Cambiar el modelo…», pausar, comprobar, ver el uso, deshacer). «Ir a…» y «Cambiar el modelo…» abren su lista; ⌫ con la caja vacía o Esc vuelven. Orden de T3: todas las palabras deben aparecer, pesa más el título, en empate lo reciente primero. Atajos: Ctrl+K abre y cierra (Código no lo usa), Ctrl+⇧P pausa, Ctrl+N sigue siendo «Nuevo chat» en Chats y «Nueva tarea» en Código.

## 12. «Hablar»: voz en directo con un bot (Codex realtime)

- `server/voice-live.mjs` + `src/lib/voiceCall.js` + `src/components/v2/chat/VoiceCall.jsx`. Usa el Codex de este ordenador y su login de ChatGPT (`codex --enable realtime_conversation app-server`, protocolo realtime v3, transporte WebRTC; el transporte «websocket» exige clave de API). Sin cookies de chatgpt.com ni clave de API.
- `GET /api/voice-live?botId=` → `{available, reason, voices, defaultVoice, voice, active}`; `PUT /api/voice-live/bots/:id/voice {voice}` guarda la voz en la ficha del bot (`liveVoice`).
- `POST /api/voice-live/calls {missionId, sdp, voice?}` (solo el chat de un bot) → `{id, sdp, voice}`: la pantalla manda su oferta WebRTC (micrófono + canal «oai-events») y recibe la respuesta; el audio va directo pantalla ⇄ OpenAI. Una llamada a la vez; 30 min como máximo; sin pantalla escuchando, cuelga sola a los 45 s.
- `GET /api/voice-live/calls/:id/events` (SSE): `state` (live | thinking), `caption {role, delta}`, `said {role, text}`, `tool {name, status, label}`, `confirm {id, accion, detalle}`, `confirmed`, `error`, `closed {reason}`. Cada `said` se guarda como mensaje del chat (`voice: true`, en el orden en que se dijo).
- El bot habla con su SOUL e instrucciones (`composeInstructions`) y los últimos mensajes del chat (`initialItems`). Para datos privados el modelo de voz pasa la petición al hilo de Codex, que solo tiene herramientas de lectura: `consultar_memoria`, `buscar_historial`, `leer_correo`, `ver_agenda` (Gmail y Google Calendar por Conexiones, solo lo que el servicio marca como lectura, como contenido externo) y `pedir_confirmacion`. Sin terminal, web, apps, plugins ni los servidores MCP de la persona; aprobaciones de Codex rechazadas.
- Líneas rojas: enviar, comprar, publicar, pagar o borrar no se hacen por voz. `pedir_confirmacion` pone una tarjeta en pantalla; `POST /api/voice-live/calls/:id/confirms/:cid {approve}` con `true` pasa la petición al chat como mensaje de la persona (con su muro de aprobación de siempre). Sigue valiendo 10 min después de colgar.
- `DELETE /api/voice-live/calls/:id` cuelga. Interrumpir es hablar por encima (detección de turno del modelo de voz); silenciar apaga la pista del micrófono.

## 13. «Personas»: hablar con otras Colmenas (fase 1, idea de Reef de OpenClaw)
Detalle del protocolo, el buzón y los límites en `docs/PEOPLE.md`. Todo bajo `/api/peers` (mismas reglas de origen y token que el resto); `GET /api/state` trae `peers` = `{me, relay:{url,status,error}, contacts, invites, shares}` o `null` mientras se preparan las claves.
- `POST /api/peers/invites {name}` → `{id, code, text, expiresAt}`: un código `COLMENA-XXXX-XXXX-XXXX-XXXX` de un solo uso (24 h). Colmena no lo envía: la persona lo copia y lo manda ella. `DELETE /api/peers/invites/:id` lo cancela.
- `POST /api/peers/invites/preview {code}` → `{name, words, expiresAt, already}`; `POST /api/peers/invites/accept {code}` → `{contact, dm}`. `words` son las cuatro palabras de seguridad, iguales en las dos Colmenas.
- `PATCH /api/peers/contacts/:id {asks?:{libre,bots,archivos}, verified?}`; `DELETE /api/peers/contacts/:id` (avisa a la otra persona).
- `POST /api/peers/dm/:contact` → la conversación directa; `POST /api/peers/shares {title, members}` → un grupo (hasta 32 personas, firma quién está quien lo crea); `POST /api/peers/shares/:id/members {members}`; `POST /api/peers/shares/:id/leave`.
- `GET /api/peers/shares/:id/messages?before=` → `{share, messages, more}`; `POST /api/peers/shares/:id/messages {text, replyTo?}`; `POST …/seen`; `POST …/typing`; `POST /api/peers/messages/:id/reactions {emoji}` (alterna); `POST /api/peers/messages/:id/retry`.
- `GET /api/peers/events?share=` (SSE): `message {shareId, message}`, `typing {shareId, names}`, `seen`, `presence`, `relay {status}`. «Escribiendo» y la presencia nunca se guardan.
- `PATCH /api/peers/settings {relayUrl}`: el buzón (https, o http solo en este ordenador). También `COLMENA_RELAY_URL`.
- Fases 2 y 3: `POST /api/peers/shares/:id/messages` admite `mentions: [{owner, bot}]` (bots elegidos con «@»). Los mensajes pueden traer `bot {id,name,role,color,shape}` (escrito por un bot de su autor), `local: true` (solo lo ves tú) y `card {kind:"meeting", id}` con `meeting` (la reunión tal como está ahora). `GET /api/peers/events` añade `thinking` (bots pensando) a `typing` y el evento `meeting {shareId, meeting}`.
- Reuniones: `GET /api/peers/meetings/:id`; `GET …/preview` (tus bloques ocupados de esa ventana, sin títulos: lo que se enviaría); `POST …/share {always?}`; `POST …/decline`; `POST …/vote {slot}` (índice, o -1 si ninguno te va); `POST …/cancel` (quien organiza).
