# Uso del ordenador (navegador, documentos, apps y comandos)

Los bots pueden navegar por la web, rellenar formularios, descargar, abrir documentos y apps y ejecutar
programas de este ordenador. Patrón de OpenClaw (snapshot de accesibilidad con referencias → actuar sobre
la referencia → volver a leer), adaptado a una persona no técnica: todo se ve en directo, todo lo que
envía, compra, publica o ejecuta pasa por la Bandeja y siempre se puede «Tomar el control».

## Piezas

| Archivo | Qué hace |
|---|---|
| `desktop/browser.cjs` | Navegador de los bots (Electron). Una ventana oculta por misión y bot (`BaseWindow` + `WebContentsView`), partición `persist:colmena-navegador`, `sandbox`, sin preload ni Node. CDP (`debugger.attach('1.3')`): `Accessibility.getFullAXTree` → snapshot; `DOM.getContentQuads` + `Input.dispatch*` para actuar; `Page.captureScreenshot` (JPEG 60, ≤1280 px) y fotogramas cada segundo mientras el bot actúa (90 s) o la persona tiene el control. |
| `desktop/axsnapshot.cjs` | AX tree → texto con refs `e1, e2…` (rol, nombre, valor, estado; máx. 12 000 caracteres; `query` filtra). Detecta captcha/2FA/contraseña/pago. |
| `desktop/netguard.cjs` | Copia CommonJS de la política de `server/web.mjs`: solo http(s) públicos; bloquea loopback, LAN, link-local, `file:`, nombres `.local`/sin punto y DNS que resuelve a IP privada (falla cerrado). Se aplica en `webRequest.onBeforeRequest`, `will-navigate`, `will-redirect`, `will-frame-navigate` y ventanas nuevas. |
| `desktop/main.cjs` | Arranca el servidor con `stdio: [..., 'ipc']` y `COLMENA_COMPUTER=1`; crea el gestor y responde con `attachBackend`. Al cerrar la ventana principal sale de la app. |
| `server/computer/bridge.mjs` | `computer.available`, `computer.call(op,args)`, `onFrame`, `onEvent`, `lastFrame(missionId)`. Sin Electron (`npm run dev`, tests) `available === false`. |
| `server/computer/policy.mjs` | Tabla de políticas, comandos peligrosos, extensiones, textos de aprobación, verbos. Pura. |
| `server/computer/system.mjs` | Carpetas (sin `..`, ADS ni enlaces), apps permitidas, `resolveProgram` y `runProgram` (sin shell). |
| `server/computer/tools.mjs` | Definiciones, `planComputerCall`, `executeComputerTool`, salida para el modelo, reglas con caducidad. |
| `server/computer/routes.mjs` | Endpoints `/api/computer/*`. |
| `src/components/computer/` | `BrowserLive.jsx` (vista en vivo + `useBrowserFrames`) y `ApprovalShot.jsx` (captura y campos de una aprobación). |

## Protocolo IPC

```
servidor → Electron  {type:'computer', id, op, args}
Electron → servidor  {type:'computer-result', id, ok:true, result} | {type:'computer-result', id, ok:false, error:{message, code}}
Electron → servidor  {type:'computer-frame', missionId, botId, tabId, url, title, takeover, jpegBase64}
Electron → servidor  {type:'computer-event', event:'takeover'|'returned'|'closed', missionId, botId}
```
Ops: `status, open, snapshot, screenshot, inspect, formSummary, act, fill, download, takeover, close, closeMission, watch, openPath`.
Todas las ops de pestaña llevan `missionId` y `botId`. Errores con `code`: `PASSWORD`, `TWO_FA`, `PAYMENT`, `SUBMIT`,
`STALE_REF`, `NO_REFS`, `TAKEOVER`, `BLOCKED_URL`, `COVERED`, `NOT_VISIBLE`, `NO_TAB`, `DOWNLOAD_FAILED`, `TIMEOUT`, `UNAVAILABLE`.

## Política

| Herramienta | sugiere | avisa | solo |
|---|---|---|---|
| `browser_open`, `browser_read`, `browser_screenshot` | libre | libre | libre |
| `browser_act` (click, escribir, elegir, tecla) | aprobación | libre + aviso | libre + aviso |
| `browser_act` (desplazar, esperar) | libre | libre | libre |
| `browser_fill`, `browser_download`, `open_file` | aprobación | libre + aviso | libre + aviso |
| `browser_submit` | **línea roja** | **línea roja** | **línea roja** |
| `open_app` | aprobación | libre + aviso | libre + aviso |
| `run_command` | aprobación | libre + aviso | libre + aviso |
| `run_command` peligroso | **línea roja** | **línea roja** | **línea roja** |

- Autonomía por defecto (2026-10-20, modo auto de Codex/OpenClaw): lo que se queda en este ordenador no pregunta;
  solo las líneas rojas (enviar, pagar, publicar, borrar, contraseñas, instalar programas) esperan el OK.
- Usar una app del escritorio (`desktop_*`) tampoco pregunta salvo con «sugiere»; botones y atajos que envían, pagan,
  publican o borran siguen siendo línea roja.
- La seguridad de misión «preguntar» se pasa como `ctx.autonomy = 'sugiere'`.
- **Reconversión a envío**: un `click` sobre un botón `type=submit` de un formulario (salvo búsquedas GET sin datos
  sensibles), sobre un botón cuyo texto es «Comprar/Pagar/Enviar/Publicar/Confirmar pedido…» o en una página con campos
  de pago se convierte en `browser_submit` (`plan.approval.reconverted = true`). Enter dentro de un formulario se rechaza
  igual. La comprobación se hace en un *isolated world* de CDP: la página no puede falsear las respuestas.
- `browser_submit` aprobado vuelve a leer el formulario: si cambió un campo o el dominio de destino, no envía.
- **Contraseñas nunca**: escribir en `input[type=password]` devuelve «Este campo es una contraseña: pide a la persona
  que tome el control». Lo mismo para códigos de un solo uso (2FA) y campos de tarjeta/IBAN. Los snapshots nunca
  muestran el valor de una contraseña.
- **Comandos**: spawn **sin shell**, argv, `cwd` = carpeta de la misión o carpeta compartida con acceso `escribe`,
  entorno mínimo (sin claves ni variables de Colmena), 120 s, 200 KB de salida. Solo `.exe/.com`; los scripts
  (`.bat .cmd .ps1…`) y las órdenes internas de la consola (`dir`, `del`…) no se pueden ejecutar. Línea roja:
  instalar/borrar/cambiar el sistema (winget, choco, msiexec, del, rmdir, rm, Remove-Item, format, reg, sc, net,
  netsh, schtasks, taskkill…), consolas (cmd, powershell, pwsh, wsl, bash), código en la propia orden (`python -c/-m`,
  `node -e/-p`, `ruby -e`…), gestores de paquetes (`npm install`, `pip install`, `npx`…), `git push/clean/reset --hard`,
  `curl -d/-o`, ssh/scp. «Permitir siempre» crea una regla ligada al **ejecutable resuelto + argumentos exactos +
  carpeta**, que caduca a los 30 días.
- **Por qué todo comando pasa por la Bandeja**: en Windows no hay un sandbox ligero (como bubblewrap o seatbelt) que
  se pueda usar sin instalar nada ni pedir permisos de administrador. Un programa lanzado por un bot tendría los mismos
  permisos que la persona. Por eso ningún comando se ejecuta sin que ella lo vea y lo apruebe.
- **Archivos**: `open_file` solo abre documentos de una lista (pdf, docx, xlsx, imágenes…) y rechaza `.exe .bat .cmd
  .ps1 .lnk .msi .vbs .js .jar .scr .com .hta .reg .url`, documentos con macros, nombres con punto final o `:`.
- **Descargas**: van a `<misión>/descargas/`; nunca se abren. Programas y scripts se cancelan; límite 200 MB.
- **Captcha / 2FA / pagos**: el snapshot devuelve `blocker: {tipo, mensaje}` y la descripción de las herramientas
  ordena parar y pedir «Tomar el control».
- Las páginas se marcan como dato no fiable (`notice`). Diálogos JS: `alert` se acepta, `confirm/prompt` se cancelan
  (y se devuelven al bot en `dialog`). Permisos del navegador (cámara, micro, ubicación, notificaciones): denegados.

## Proyectos (desarrollos a medida)

`server/projects/` da a los bots con capacidad «ordenador» un proyecto real por misión en
`<misión>/proyectos/<nombre>/` (registrado en `server/index.mjs` como `runtime.projects`).

- **Herramientas**: `project_create` (plantillas `vite-react`, `html`, `vacio`), `project_files` (recursivo, sin
  `node_modules`/`.git`/`dist`), `project_write` (crea o sobrescribe), `project_edit` (sustitución exacta, cada
  `old` una sola vez, todo o nada), `project_delete` (a `<misión>/.papelera/<fecha>/…`), `project_run`
  (`install` · `script` · `node`), `project_server` (`start|stop|status|logs`) y `project_preview`.
- **Plantillas offline**: `vite-react` copia sus dependencias (Vite, React, plugin de React y lo que necesitan) del
  `node_modules` de Colmena y escribe atajos `.bin/*.cmd`: arranca sin internet ni aprobación de instalación.
- **npm y node sin consola**: `node.exe` (el del servidor) ejecuta `npm-cli.js`; un script simple de una herramienta
  local («vite build») se ejecuta directamente con node. Entorno mínimo (sin claves de Colmena) y, salvo en
  `install`, npm `offline` y proxy nulo `127.0.0.1:9` (con `NODE_USE_ENV_PROXY`). Límite 120 s; build/test/install 600 s.
- **Servidor de desarrollo**: puerto libre de `127.0.0.1:5200-5299`, uno por proyecto, 3 a la vez. Una web estática
  la sirve Colmena (`node:http`, sin salir de la carpeta). Un script `dev`/`start` corre como proceso hijo; Vite recibe
  `--host 127.0.0.1 --port N --strictPort`. Registro de 400 líneas. Se para con la herramienta, con «Parar» del panel
  Terminal (`GET /api/missions/:id/devservers`, `POST …/devservers/:project/stop`), al cancelar o borrar la
  conversación y al cerrar Colmena; siempre por el PID que lanzó Colmena (`taskkill /T`).
- **Vista previa**: `project_preview` arranca el servidor si hace falta y pide a Electron la operación `preview`
  `{missionId, botId, url, port}`. Ese puerto queda abierto **solo para las pestañas de esa misión** (http y ws del
  HMR; el resto de localhost, la API de Colmena y la LAN siguen bloqueados); `previewRevoke` lo cierra al parar.
  Devuelve errores y avisos de consola (CDP `Runtime`/`Log`, activados solo en la vista previa), el texto visible y
  una captura que llega al modelo como imagen. Máximo 3 rondas con errores por proyecto y paso; la cuarta se niega.
- **Política**: con «avisa» o «solo», editar, ejecutar el código del proyecto (scripts, `node`, servidor Node) e
  instalar sus paquetes es libre (la instalación se anuncia en la sala). Con «sugiere»: editar y ejecutar piden
  permiso **una vez por proyecto y bot** (regla `tool: "project"`, `scope: "proyecto:<misión>/<nombre>:ejecutar"`) e
  instalar pide permiso **una vez por proyecto** con la lista de paquetes y solo vuelve a preguntar por paquetes nuevos; siempre `--ignore-scripts`; solo versiones del registro
  (nada de `file:`, git, URLs ni alias). `run_command` sigue igual y rechaza `npm` remitiendo a `project_run`.
  Límite honesto: el código del proyecto corre con los permisos de la persona; Windows no permite aislarlo ni
  cortarle la red por proceso sin ser administrador.

## «Tomar el control»

`POST /api/computer/takeover {missionId, action:'take'|'return', botId?}`. Al tomarlo, la ventana del navegador se
muestra con una barra superior en el color del bot («Tienes el control del navegador de Nora… Devolver el control»),
las referencias se invalidan, el bot no puede actuar (`TAKEOVER`) y la misión, si estaba trabajando, se pausa
(`runtime.stop(id)`). Al devolver (botón de Colmena, botón de la barra o cerrar la ventana) Electron envía
`returned`; el servidor añade una pista al hilo («vuelve a leer la página») y relanza la misión.

## Puntos de enganche (coordinador)

### `server/tools.mjs` / `server/runtime.mjs`

```js
import { computer } from "./computer/bridge.mjs";
import {
  computerToolDefs, isComputerTool, planComputerCall, executeComputerTool, verbForComputer, computerActivityDetail,
  findComputerGrant, addComputerGrant, toolOutputFor, forReceipt, compactImages,
} from "./computer/tools.mjs";
```

1. **Definir herramientas** (en `runStep`, donde se calcula `tools`): salvo en pasos `plan`/`critique`, añadir
   `...computerToolDefs(bot, { available: computer.available, settings: this.settings() })`. En `tool()`, la
   comprobación «herramienta disponible» debe aceptar esos nombres.
2. **Verbo** (en `runStep`, antes de `this.tool(...)`): `isComputerTool(call.name) ? verbForComputer(call.name, args) : verbFor(call.name, args)`
   y detalle con `computerActivityDetail(call.name, args)`. Verbos nuevos: «navegando», «rellenando un formulario»,
   «usando el ordenador», «ejecutando una tarea» (añadirlos a `VerbIcon`/`normalizeVerb` en el cliente).
3. **Política + aprobación + ejecución** (en `tool()`, antes de `schemas[call.name]`):

```js
if (isComputerTool(call.name)) return await this.computerTool(mission, step, call, signal);

async computerTool(mission, step, call, signal) {
  const bot = this.bot(step.botId);
  const approvalId = step.id + ":" + call.call_id;
  const ctx = {
    missionId: mission.id, botId: bot.id, bot, autonomy: this.autonomy(mission, bot), missionRoot: this.root(mission.id),
    folders: accessibleFolders(this.store, bot.id), settings: this.settings(), computer, signal,
  };
  let a = this.store.get("approvals", approvalId);
  if (!a) {
    const plan = await planComputerCall(call.name, JSON.parse(call.arguments), ctx);
    this.setActivity(bot.id, mission.id, step.id, plan.verb, plan.detail);
    if (plan.policy === "free") {
      const result = await executeComputerTool(plan.name, plan.args, ctx);
      if (plan.announce) this.announce(mission.id, bot, plan.announce, approvalId);
      return result;
    }
    const p = plan.approval;
    const grant = plan.policy === "approval" && findComputerGrant(this.store, { botId: bot.id, tool: plan.name, scope: p.grantScope });
    a = this.store.put("approvals", {
      id: approvalId, missionId: mission.id, botId: bot.id, stepId: step.id, callId: call.call_id,
      tool: plan.name, args: plan.args, kind: "permission", scope: p.grantScope, scopeLabel: p.scopeLabel,
      title: p.title, summary: p.summary, context: this.approvalContext(mission, bot), blocks: 1, options: [], email: null,
      canAlways: p.canAlways, redLine: p.redLine, grantDays: p.grantDays, computer: p.computer,
      status: grant ? "approved" : "pending", createdAt: now(),
      decidedAt: grant ? now() : null, decidedBy: grant ? "regla" : null, resolution: grant ? "Aprobado por una regla" : null,
    });
    if (!grant) {
      this.store.event(mission.id, "approval_requested", { botId: bot.id, text: p.summary });
      return { waiting: true };
    }
  }
  if (a.status === "pending") return { waiting: true };
  if (a.status === "denied") return { denied: true, message: "La persona denegó esta acción. No la repitas." };
  if (a.status === "executed") return a.result;
  const result = await executeComputerTool(a.tool, a.args, { ...ctx, approved: true, approval: a });
  this.store.patch("approvals", approvalId, { status: "executed", result: forReceipt(result) });
  return result;
}
```

   `executeComputerTool` lanza `Error` con mensaje en español (y `code`); el `catch` actual de `tool()` ya lo
   convierte en `{error}` para el modelo. Las herramientas con aprobación/línea roja se niegan sin `approved: true`.
4. **«Permitir siempre»** (en `approve()`): si `isComputerTool(a.tool)`, usar `addComputerGrant(this.store, a)` en lugar
   de `addGrant` (respeta la caducidad de 30 días de los comandos y rechaza líneas rojas). La comprobación existente
   `!a.canAlways` ya impide reglas para `browser_submit` y comandos peligrosos.
5. **Capturas para el modelo**: al guardar el recibo usar `forReceipt(result)` (sin imagen en SQLite) y, para la
   salida de la llamada, `output: toolOutputFor(call.name, result)` cuando el resultado es fresco (con
   `browser_screenshot` devuelve `[input_text, input_image]`; con recibos antiguos, texto). Antes de `infer`, pasar
   `compactImages(step.history)` para conservar solo la última captura. Si el proveedor no admite imágenes en
   `function_call_output`, usar `toolOutputFor(name, result, { images: false })`.

### `server/app.mjs`

```js
import { computer } from "./computer/bridge.mjs";
import { registerComputerRoutes } from "./computer/routes.mjs";
registerComputerRoutes(app, { store, runtime, computer }); // antes de app.use("/api", 404)
```
Endpoints: `GET /api/computer/status`, `GET /api/computer/events?mission=` (SSE propio de fotogramas y eventos),
`GET /api/computer/frame/:missionId`, `POST /api/computer/takeover`, `GET /api/computer/approval/:approvalId`,
`GET /api/computer/shot/:approvalId` (JPEG de `<misión>/capturas/`), `GET|PUT /api/computer/apps`
(lista de apps permitidas, `settings.allowedApps`; `PATCH /api/settings` es estricto y no la acepta).

Fotogramas: solo en memoria (último por misión), máx. 1/s por misión. Se reemiten a `store.listeners` como
`{type:'browser_frame', mission, botId, url, title, takeover, image:'data:image/jpeg;base64,…'}`; `/api/events` los
ignora salvo que se añada `'browser_frame'` a `LIVE`. `BrowserLive` no lo necesita (usa su propio SSE).

### `src/lib/store.jsx` (opcional)

Si se añade `browser_frame` a `LIVE`, tratarlo **antes** de `schedule()` para no refrescar `/api/state` cada segundo:
`if (event.type === "browser_frame") { window.dispatchEvent(new CustomEvent("colmena:browser_frame", { detail: event })); return; }`

### Pantallas

- `<BrowserLive missionId={id} bot={bot} verb={activity[bot.id]?.verb} missionActive={…} />` en En vivo / Sala.
- `<ApprovalShot approvalId={a.id} />` dentro de la tarjeta de la Bandeja. `approvalView` (state.mjs) no expone
  `tool`/`computer`: añadir `computer: !!a.computer` para mostrarla solo cuando toca (si no, el componente hace la
  petición y no pinta nada).

## Pruebas

`node --test tests/computer-*.test.mjs` (bridge falso, sin Electron): políticas por autonomía, línea roja de envío y
comandos peligrosos, extensiones ejecutables, IPs privadas y DNS rebinding, contraseñas, snapshot, reglas con caducidad,
fotogramas sin SQLite, rutas de captura y toma de control.
