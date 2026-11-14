# Conectores de Colmena

## Implementacion

Motor reutilizado: NEXO alpha.29, app/ai/composio.mjs y sus listas auditadas de lectura. Licencia conservada en licenses/NEXO.txt. Adaptaciones: identidad colmena-composio-v1, usuario remoto propio y vault explicito bajo LOCALAPPDATA/Colmena/connections. No se leen ni migran secretos de NEXO.

Composio es infraestructura interna. La UI no incluye su nombre, clave, configuracion ni endpoint para introducirla. El operador puede provisionar COLMENA_COMPOSIO_KEY en el entorno del proceso servidor; la clave se valida, se cifra con Windows DPAPI y se elimina del entorno del proceso. Nunca debe incluirse en el bundle, repositorio, URL, argumentos de terminal ni logs. Sin provisionamiento se indica indisponibilidad del servicio, no se pide una clave al usuario.

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
- Servidores MCP propios: disponibles por HTTP/SSE con OAuth (registro dinamico, PKCE, tokens en DPAPI) en `server/mcp/hub.mjs`; los servidores locales por stdio no se admiten.
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
