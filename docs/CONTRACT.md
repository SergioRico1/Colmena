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
