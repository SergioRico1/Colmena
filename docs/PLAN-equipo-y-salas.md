# Plan: equipos, salas unidas y barra lateral nueva

Planteamiento de diseño acordado con el dueño el 2026-11-12 (método `shape` de Impeccable). No es
código ni una especificación técnica: dice qué se construye y cómo debe comportarse. Parte de la
crítica guardada ese día (28/40) y de `PRODUCT.md`.

## 1. Para quién y para qué

- **Quién llega:** una persona que trabaja con compañeros y con bots. Dos perfiles por igual: quien
  delega trabajo de oficina sin saber programar y quien usa Código y el Modo experto. El caso que
  hoy no está servido es el de quien dirige un equipo y quiere hablar con sus compañeros y con los
  bots de todos en un mismo sitio.
- **Qué necesita:** un solo lugar donde están las personas, los bots y las conversaciones; saber de
  un vistazo quién es persona y quién es bot, de quién es cada bot, quién está trabajando y qué
  espera su decisión.
- **Modo:** operar. Manda la lectura rápida, la consistencia y lo que la gente ya conoce de un chat
  de equipo.

## 2. Resultado y prueba

- **Tarea principal:** abrir una sala, escribir a personas y a bots en la misma conversación, y
  decidir lo que te espera sin salir de ella.
- **Éxito:** alguien que viene de Slack entiende la barra sin explicación; nadie confunde un bot con
  una persona; «Te necesitan» significa siempre «te espera a ti» y da la misma cifra en todas
  partes.
- **Lo que solo Colmena puede decir:** cada bot trabaja en el ordenador de su dueño, con su cuenta
  de IA y sus datos. El equipo comparte la conversación, no los datos. Lo que sale del ordenador de
  alguien lo aprueba ese alguien.

## 3. Dirección elegida

- **Autoridad visual:** el sistema de diseño actual de Colmena (tokens, tipografía, formas de los
  bots, tarjetas). No se cambia de mundo visual; se cambia la estructura. La barra de seis sitios
  del lienzo deja de ser la referencia para la barra lateral.
- **Tesis de estructura:** la barra pasa de «sitios» a «con quién hablas». Arriba, el equipo;
  después, cinco sitios; después, tres grupos vivos: Salas, Bots y Personas.
- **Tesis de interacción:** una sola sala. Lo que hoy son la sala local (tú y tus bots, con
  herramientas y planes) y la conversación con personas pasa a ser el mismo objeto y la misma
  pantalla: una sala puede tener personas, y los bots de cada uno trabajan en ella de verdad.
- **Momento central:** un compañero pide algo al bot de otro dentro de la sala, el dueño lo
  autoriza, el bot trabaja, y todos ven que está trabajando y lo que entrega.

## 4. Alcance y límites

**Entra, antes del lanzamiento:**

1. **Equipo con nombre compartido.** Un equipo tiene nombre, lista de personas y, de cada persona,
   sus bots. Todos sus miembros lo ven igual. Se crea o se entra con un código. Se puede estar en
   varios equipos y cambiar entre ellos desde la cabecera. Se puede hablar por mensaje directo con
   personas que no están en ningún equipo tuyo.
2. **Barra lateral nueva.**
   - Cabecera: nombre del equipo y «N personas · N bots»; al pulsar: cambiar de equipo, invitar,
     crear o unirse a otro, ajustes del equipo.
   - «Nuevo» y «Buscar o pedir» (Ctrl+K), como hoy.
   - Sitios fijos: Inicio (con el contador de lo que te espera), Trabajo, Código, Equipo,
     Biblioteca. «Chats» deja de ser un sitio.
   - Grupo **Salas**: `#` y nombre; sin leer en negrita con su número.
   - Grupo **Bots**: tus bots, con su forma, su nombre, su papel debajo y su estado (trabajando, te
     espera, libre).
   - Grupo **Personas**: mensajes directos, con avatar redondo, presencia y estado.
   - Cada grupo se pliega y tiene su «+». Pie: tú y tu estado, resumen de actividad, Modo experto.
3. **Sala unida.** Una pantalla para todas las salas.
   - Las personas escriben con avatar redondo y nombre. Los bots, con su forma, su nombre, su papel
     y «bot de Lucía» cuando no es tuyo. El círculo queda reservado a las personas.
   - Panel de miembros: Personas (con su papel en la sala) y Bots agrupados por dueño.
   - Invitar a una persona se hace desde la propia sala.
   - Cualquiera puede pedir algo al bot de otro con una mención. Decide la regla del dueño para esa
     persona: Pregúntame, Siempre o Nunca. Las líneas rojas las aprueba siempre el dueño.
   - Del trabajo de un bot ajeno se ve lo que dice, lo que entrega y una línea de estado («Vera
     está trabajando», «usó 4 herramientas · 12 min»). Nunca el contenido de las herramientas ni
     los archivos de su dueño, salvo lo que se comparta.
   - Un relevo entre bots se muestra como una línea («Vera ⇄ Atlas»).
   - Lo que espera a otra persona se ve en tono neutro («Vera espera el OK de Sergio»). La tarjeta
     en miel, con sus botones, solo la ve quien tiene que decidir.
4. **Persona frente a bot en toda la app**, con las mismas reglas que en la sala.
5. **Bienvenida y ayuda** que hablan de compañeros: crear un equipo, unirse a uno o empezar solo.
   Desaparece «No es como Slack o WhatsApp».

**No entra:** app de móvil, dispositivos conectados, hilos como sitio propio, barra de formato de
texto, canales públicos que cualquiera del equipo puede descubrir (ver decisiones abiertas).

**No se toca:** la pantalla de revisar un envío, las tarjetas de plan y de pregunta, el selector de
autonomía, las formas de los bots, el chat a solas con un bot, Trabajo, Código, Biblioteca y
Ajustes más allá de renombrar «Personas».

**Lo que haría que estuviera mal aunque quedara bonito:**

- parecerse a agentes.chat: nada de mascotas pixeladas, ruido de fondo ni su vocabulario;
- que la miel signifique «alguien tiene algo pendiente» en lugar de «te espera a ti»;
- que un compañero vea rutas, correos o archivos del ordenador de otro;
- que algo salga del ordenador de alguien con el OK de otra persona.

## 5. Estados y cantidades

- **Cantidades reales:** 1 a 32 personas por sala; 1 a 5 equipos por persona; 3 a 12 bots propios;
  hasta unos 40 bots visibles en un equipo; 5 a 40 salas; 0 a 20 mensajes directos.
- **Estados que importan:**
  - sin equipo todavía (solo tú): la barra funciona igual, con «Solo tú» en la cabecera y una
    invitación clara a crear o unirse;
  - equipo recién creado, sin nadie más;
  - invitación pendiente, caducada o rechazada;
  - compañero desconectado: sus bots no pueden trabajar y se dice («Lucía no está; Vera contestará
    cuando vuelva»);
  - buzón sin conexión: los mensajes quedan «Enviando…» y se reintentan;
  - compañero con una Colmena anterior que no entiende equipos: se le ve como contacto directo;
  - te quitan de una sala o de un equipo;
  - el dueño niega o no contesta una petición a su bot;
  - muchas salas: las que no tienen nada nuevo se pliegan tras «Ver todas»;
  - el mismo aviso en una sala con varias personas: cada uno ve en miel solo lo suyo.

## 6. Interacción y disposición

- **Jerarquía de la barra:** equipo, acciones, sitios, grupos, tú. Lo vivo (sin leer, alguien
  trabajando, algo te espera) se nota en los grupos, no en los sitios.
- **Un solo número.** El contador de Inicio, el del pie y los de Trabajo y Actividad salen de la
  misma cuenta: lo que te espera a ti.
- **Señales:** sin leer es negrita y número; te espera es miel; trabajando es movimiento discreto
  junto al bot; ausente es apagado. Nunca solo color: siempre con palabra o forma.
- **Cambio de equipo:** cambia salas y personas; tus bots son los mismos en todos tus equipos.
  Trabajo, Código y Biblioteca son tuyos, no del equipo.
- **Dentro de la sala:** la conversación es lo único que se desplaza; el compositor queda abajo; el
  panel de miembros se pliega. Con teclado se llega al compositor sin recorrer la barra.
- **Respuesta a cada acción:** enviar, invitar, pedir a un bot ajeno y decidir muestran enseguida en
  qué estado quedan («Esperando a Sergio», «Lucía lo ha visto»).

## 7. Restricciones y decisiones abiertas

- **Plataforma:** escritorio (Windows y Mac), ventana sin marco, interfaz en español llano.
- **Accesibilidad:** región principal y salto al compositor en la sala, anuncio de mensajes nuevos,
  contraste 4,5:1 también en textos de ayuda, objetivos de al menos 24 px.
- **Consecuencia técnica (no es diseño, pero condiciona el orden):** hoy son dos motores. Unirlos
  exige que el equipo sea una lista firmada compartida, que los mensajes y el estado de un bot
  viajen cifrados por el buzón a los demás, y que una petición con herramientas al bot de otro
  pase por la regla del dueño. Las salas actuales pasan a ser salas privadas; los grupos de
  personas actuales, salas sin equipo.
- **Orden de construcción propuesto:**
  1. equipo, barra nueva y pantalla de sala única (personas y bots a la vista, invitar desde la
     sala);
  2. bots trabajando con herramientas en salas con compañeros (estado y entregas compartidos,
     peticiones entre dueños);
  3. bienvenida, ayuda y el resto del plan de la crítica (aprobar igual en todo, un solo contador,
     Inicio más corto, accesibilidad, escala de letra, cierre al terminar).
- **Decisiones cerradas (confirmadas por el dueño el 2026-11-12):**
  1. Cada equipo nace con una sala de todos, «general», en la que está cada miembro.
  2. Salvo «general», todas las salas son por invitación. Las salas que cualquiera puede descubrir
     quedan para después del lanzamiento.
  3. Administra el equipo quien lo crea, y puede nombrar a otros administradores. Administrar es
     invitar, quitar, renombrar y nombrar administradores.
  4. Se llama «Sala».
  5. La ruta de «Chats» abre la última conversación.
  6. Los bots de un compañero no aparecen en tu grupo «Bots»: se ven dentro de las salas y en
     Equipo.
