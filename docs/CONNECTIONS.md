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
- MCP personalizado de NEXO no se ha portado: no hay pantalla de alta/configuracion MCP suministrada.

## Verificacion 2026-10-15

- Pruebas Node aisladas para el motor heredado, permisos de Colmena, API sin configuracion de secretos, bloqueo de duplicados y restauracion segura.
- Prueba de fidelidad: cada estilo inline retenido y el stylesheet de 09b/09c coincide con el fuente; unica adicion funcional al bloque de correo: preservar saltos de linea y envolver palabras/direcciones largas para no ocultar contenido revisado. Las referencias originales permanecen intactas.
- Playwright contra fixture desechable, sin red externa ni cuentas reales: busqueda, filtros, nombre libre/presets, lectura, permiso recordado, pulsacion mantenida, clic corto sin efecto y desconexion.
- Comparacion visual guardada en output/playwright/connections-*.png. Cabecera 09b original e integrada: x328 y96, 800x41. Sin errores JS en los flujos probados.
- A 390px se observa el ancho original de 1440px; se registra como limitacion, no como responsive aprobado.
- OAuth de apps, acceso real Gmail/Calendar e instalador nativo no se han verificado. No se han enviado correos ni conectado cuentas reales.

Reproducir: npm run check. Para QA visual aislado: node scripts/connections-qa-server.mjs y ejecutar scripts/connections-ui-check.snippet.js con playwright-cli run-code --filename desde una pagina de ese servidor. No usar ese script contra datos reales.
