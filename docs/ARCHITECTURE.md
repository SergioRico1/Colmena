# Colmena

Aplicación de escritorio (Electron) con un servicio local Node 24 + Express 5 + SQLite (`node:sqlite`) y una SPA React 19 + Vite. El servicio solo escucha en loopback; las mutaciones exigen token CSRF y origen local. De momento es solo escritorio: sin nube ni móvil.

## Frontend: fidelidad al diseño
- Fuente de verdad: el lienzo de diseño (artefacto «Colmena — harness de bots»), copiado en `design/*.dc.html` (+ 09b/09c de NEXO).
- `npm run design` (`scripts/dc-to-jsx.mjs`) convierte cada maqueta en `src/design/<Pantalla>.jsx` sin cambios (mismo marcado, estilos inline y lógica). Se ve en `/_design/<Pantalla>`.
- Las pantallas reales (`src/screens/*.jsx`) parten de ese marcado y sustituyen los datos de ejemplo por datos reales. Reglas en `docs/SCREENS.md`; contrato de datos en `docs/CONTRACT.md`; rutas en `src/routes.jsx`.
- Capa de datos `src/lib/store.jsx`: `/api/state` + SSE `/api/events` (cambios, texto en directo, actividad de cada bot).
- Pantallas nuevas diseñadas con la misma guía: Ajustes › Este ordenador, Personas, Límites y gasto, Seguridad y registro, Espacio; diálogo «Revisar pasos» de habilidades; tarjeta «Alma (SOUL.md)» del perfil del bot; sección Historial.

## Backend
- `server/app.mjs` API del contrato; `server/state.mjs` vista calculada y ligera; `server/store.mjs` registros JSON en SQLite con transacciones.
- `server/runtime.mjs` misiones: un bot, equipo (Atlas propone reparto → apruebas → trabajan → Atlas integra) y debate (propuestas → críticas por propuesta → resumen de Atlas → eliges o combinas). Checkpoints, recibos, sin repetir efectos inciertos, pausa global.
- `server/tools.mjs` herramientas: preguntar con opciones, consultar a otro bot (hilo entre bots), entregables, archivos de la misión, carpetas de «Este ordenador», web pública (`server/web.mjs`, sin IPs privadas), búsqueda en el historial (FTS5), memoria, habilidades y apps conectadas.
- Autonomía por bot (solo sugiere / actúa y avisa / actúa solo). Líneas rojas siempre con permiso: enviar fuera, mover dinero, borrar, instalar. «Permitir siempre» crea reglas revocables.
- `server/provider.mjs` ProviderHub: ChatGPT (OAuth PKCE de NEXO), clave de API de OpenAI (cifrada con DPAPI) o modelo local OpenAI-compatible; forma de pensar → esfuerzo de razonamiento; uso y límite mensual (`server/usage.mjs`).
- `server/scheduler.mjs` + `server/triggers.mjs`: 8 disparadores (día, semana, una vez, correo, archivo, evento, sala, hoja). Los que dependen de un conector quedan bloqueados con el motivo si no hay cuenta; nunca se simulan.

## SOUL (OpenClaw)
`prompts/SOUL.md` es el original literal (licencia MIT en `licenses/OpenClaw.txt`). `prompts/SOUL.colmena.md` es la adaptación frase a frase; cada bot tiene su espacio `<datos>/bots/<id>/` con SOUL.md e IDENTITY.md (`server/soul.mjs`), y `AGENTS.colmena.md` fija las reglas de trabajo y autonomía. El bot no reescribe su SOUL: propone el cambio y la persona lo aprueba en la Bandeja.

## Auto-mejora (Hermes)
`server/learning.mjs`, tras cada misión relevante: reflexión que crea habilidades (SKILL.md) al repetir tareas o en tareas complejas, propone versiones mejoradas de las que usó (con diferencias), guarda recuerdos deducidos marcados «revisar», y detecta patrones para sugerir automatizaciones o «aprobar siempre». Principio del diseño: las habilidades nuevas no se usan hasta que alguien revisa los pasos. Se desactiva en Ajustes › Espacio.

## Uso del ordenador (OpenClaw)
Cada bot tiene un navegador propio dentro de Electron (`desktop/browser.cjs`, CDP con instantáneas de accesibilidad y referencias), vista en vivo, «Tomar el control»/«Devolver», documentos y apps permitidas, y comandos sin shell. Enviar/comprar/publicar y comandos peligrosos son línea roja con captura en la Bandeja; nunca escribe contraseñas. Detalle en `docs/COMPUTER.md`; enlace al runtime en `server/computer/wire.mjs`.

## Autonomía por defecto (Codex/OpenClaw auto, 2026-10-20)
Los bots actúan sin pedir OK en todo lo que se queda dentro de Colmena, en este ordenador o en las cuentas de la persona: el plan del equipo arranca solo (la sala lo muestra con «Parar» y «Cambiar»; lo que escribe la persona llega a los bots en su siguiente paso), entregables, archivos, memoria, navegar, abrir apps y archivos, órdenes normales, ejecutar e instalar en proyectos, y cambios en sus cuentas (borradores, eventos sin invitados, filas). Solo las líneas rojas esperan: enviar a terceros, comprar o pagar, publicar, borrar de verdad, introducir contraseñas e instalar programas; un envío pedido con «envía» sale solo tras 10 s para deshacer. «Solo sugiere» (por bot) recupera las aprobaciones; en «Qué app usa cada bot», «Lee», «Pide para escribir» y «No» siguen preguntando para cambiar (las columnas «Lee» existentes pasaron una vez a «Escribe», `settings.appWrites`). El prompt de los bots (`prompts/AGENTS.colmena.md`, «Actúa sin esperar») es la «Execution Bias» de OpenClaw.

## Experiencia (openmuse)
Aprobaciones ligadas al contenido exacto con caducidad, tarjeta por herramienta, cola de mensajes en el chat, avisos («Una novedad», campana, notificaciones de Windows), ronda de Atlas cada 30 min y disparador «una página web cambia». Licencia MIT en `licenses/OpenMuse.txt`.

## Aprendizaje v2 (Hermes)
Revisión por contadores (10 mensajes / 10 herramientas) con índice de habilidades, parches mínimos, memorias con tope escritas como hechos, perfil de la persona (USER.md), curador semanal (obsoletas/archivadas, nunca borra), recorte y resumen de contexto, detección de bucles y de atascos (sin tope de pasos: el bot sigue hasta terminar; solo se para si repite el mismo fallo o falla todo varias rondas seguidas).

## Desarrollo
`npm run dev` (http://127.0.0.1:4317 o el puerto de `PORT`), `npm test`, `npm run build`, `npm run desktop`. QA visual aislada: `COLMENA_DATA_DIR=.local/qa-data node scripts/seed-qa.mjs`, servidor `qa` de `.claude/launch.json` y `scripts/qa-shots.mjs`. El código de la primera implementación (transformación de HTML) está en `legacy/`.
