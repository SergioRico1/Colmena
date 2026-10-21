# Revisión UX/IA de Colmena — pendiente y hecho

Revisión de 2026-10-16 (capturas en `output/ux/`, script en el scratchpad `ux-shots.cjs`).
Criterio: fácil como Slack, calidad de producto, sistema de diseño de Colmena, modelos de OpenAI.

## Hecho
- Barra lateral idéntica en todas las pantallas (sin variantes): salas que te esperan primero,
  «Ver todas», filas «Nueva sala» y «Contratar un bot», estado de bots en palabras, pie → Ajustes.
- Una sola cifra de «te espera» (pendientes + caducadas) en barra lateral, Inicio y Bandeja.
- Inicio: titular que cuadra con los datos; sin Bandeja duplicada ni «Nuevo bot» como acción
  principal; la caja de encargo justo tras el saludo; «Conectar apps» en vez de «0 conectores».
- Sala detenida: explica qué pasó y ofrece «Continuar»; Pausar/Reanudar con texto.
- Editar envío: estado real (sin «Enviado» falso). Zona horaria con desfase correcto.
- Ajustes: «Cuenta de IA» primero, «Apps conectadas», distintivo «CONECTAR» sin cortes.
- Misión: miga «Misiones / #sala», pestaña «Conversación» en vez de «Volver a la sala».
- Debate: sin texto repetido («La idea» solo si aporta).
- Textos del servidor con tildes (misión, acción, cerró, último…).
- Fuera el enlace a la página de referencia de disparadores.
- Permisos con el sistema de Colmena (logo, tarjeta con sombra miel, tokens) y estado «Esta solicitud ya no está» con «Ir a la Bandeja».
- Este ordenador: «Elegir carpeta…» con el diálogo nativo; el nombre se propone solo.
- Bienvenida: revisado; el paso 3 se marca hecho si ya hay misiones (correcto en un primer uso real).
- Ficha del bot: «Alma (SOUL.md)» → «Personalidad» (el guardado ya se atenúa sin cambios).
- Chat nuevo: «Ideas para empezar» según el rol del bot; «Piensa: Equilibrado»; sin «· 0 conversaciones».
- Debate: «Combinar» solo con motivo (las dos que miraste o las que nombra Atlas).
- Misión: cabecera con «Pregunta rápida», «Más» (aprendizaje) y «Copiar resumen» en vez de un enlace local.
- Sala: misma caja de escribir que el chat (marco, botones con contorno y descripción, flecha ↑, ayuda de Enter).
- Accesibilidad: foco de teclado visible en toda la app (blanco en la barra lateral), respeto a «reducir movimiento», botones de ventana fuera del orden de tabulación.
- Rendimiento: el servidor arma el estado en ~1 ms (cabecera Server-Timing); la interfaz ya no repinta si el estado no cambió y el contador de recargas vive en su propio contexto (solo lo escuchan los detalles). Los trozos de código son pequeños (<70 kB) y se precargan.
- Carga: componente común (líneas y tarjetas grises con brillo suave) en vez de «Cargando…» sueltos (Misiones, Objetivos, Permisos, ficha del bot).
- Límites: el uso también en páginas («un millón da para unas 1.500 páginas»), con los tokens como detalle.
- Personas: ya no aparece tu cuenta dos veces. Tu nombre sale de tu cuenta de ChatGPT si no has puesto otro (nunca «Tu cuenta» si se sabe).
- «Conectar apps» (/ajustes/conexiones): fuera el aspecto de NEXO; dentro de los Ajustes de Colmena, con vuelta a «Apps conectadas», tokens de Colmena y un aviso que dice qué hacer (conectar la cuenta de IA o reintentar) con su botón.
- Nuevo bot: el error al preparar (p. ej. sin cuenta de IA) sale junto al botón, con «Conectar ahora»; antes quedaba fuera de la vista.
- Biblioteca: «Lo que saben de ti» (no «Perfil… (USER.md)»), «Importar una habilidad», «Fijar» explicado.
- Ficha del bot: pestañas fijas al bajar (la cabecera de color se recoge y la barra de título toma su color); «Puede pedir ayuda a» con marca ✓ y explicación; «Conectar» en vez de «Sin conectar · conectar».
- La ventana ya no puede desplazarse nunca (antes un salto a sección movía todo 310 px): #root mide la ventana y contiene los elementos absolutos.
- Sin servicio: pantalla de arranque («Arrancando Colmena…», y qué hacer si tarda) y píldora «Sin conexión · reintentando…» / «Conectado de nuevo» (probado cortando y reabriendo el servidor en modo producción).
- Bandeja: la vista previa se queda fija al bajar por la lista. Equipo: revisado, sin cambios.
- Salas: se abren por el último mensaje y siguen los nuevos si estás abajo (como Slack); las acciones seguidas de un bot se agrupan en una línea desplegable sin repetir su nombre.
- Nombres: títulos sin «Quiero que me ayudes a…», cortados por palabra con «…»; salas con nombre útil (#planes-valladolid-espana) y «Renombrar…» en el clic derecho.
- Mensajes como en Slack: el texto pegado al nombre, acciones (reacciones rápidas, reaccionar, hilo, escuchar) solo al pasar el ratón, mensajes seguidos del mismo autor agrupados.
- Reacciones (como OpenClaw): chips bajo cada mensaje con quién reaccionó; paleta rápida y «…» para cualquier emoji. Los bots ponen 👀 mientras trabajan en tu mensaje, 👍 → ✅ en el plan que les da su parte, y reaccionan en vez de escribir acuses vacíos. Tus reacciones nunca despiertan a un bot: las ve en su siguiente turno.
- Rendimiento de los bots (como OpenClaw): prompt_cache_key + cabecera session_id por bot y misión; instrucciones con lo fijo primero y memoria/fecha al final; historial solo-añadir (el recorte de resultados antiguos va en ráfagas); herramientas de lectura en paralelo; web_fetch con caché de 15 min y sin reintentar 403/429 durante 2 min; esfuerzo bajo para resúmenes y aprendizaje; cada llamada registra tokens en caché, razonamiento y duración.
- Tablas Markdown (GFM) en los mensajes, con el estilo de la tabla interactiva.
- Aprendizajes de OpenClaw (todos):
  - lo que se cortó al cerrar Colmena sigue solo al reabrir (con freno si se cae en bucle); sin tope de tiempo: solo se para si lleva 10 min sin avanzar;
  - mensajes mientras trabajan: reorienta (por defecto, salta los cambios ya decididos), espera, junta o interrumpe, por sala;
  - tarjetas de la Bandeja con a quién afecta (destinatarios de fuera, importe y beneficiario, público/privado, borrados);
  - guardar en memoria antes de resumir;
  - memoria con origen: lo guardado tras leer webs/correos/apps queda «por revisar» y fuera de los prompts; contenido externo entre marcas y sin tokens de rol; «Olvidar lo aprendido aquí» en el clic derecho de la sala;
  - «Aprendido: …» con Deshacer en la sala; aviso «lleva N min sin avanzar» con Reintentar/Pausar;
  - contratos por parte del plan («No hace») y formato de entrega; delegaciones vacías cuentan como fallo; consultas con esfuerzo bajo;
  - tarjeta en vivo por bot trabajando; presupuesto de tokens por objetivo;
  - gasto por respuesta (y % de caché), % restante del plan de ChatGPT si el servidor lo informa, respuestas sugeridas (Tab) con el modelo más barato, revisión de Atlas solo en tu horario.

## Pendiente (por impacto)
- Transporte WebSocket con previous_response_id (solo enviar lo nuevo de cada ronda) y compactación del servidor (Codex): lo que más acelera según OpenClaw.
(nada urgente; siguientes ideas: buscador global con resultados por tipo, atajos de teclado tipo Slack —Ctrl+K, Alt+↑/↓ entre salas—, tema oscuro con los tokens de Colmena)
