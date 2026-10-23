---
name: Guía de calidad para crear habilidades
description: Úsala cuando vayas a crear, mejorar o revisar una habilidad (SKILL.md) del equipo, o cuando la persona pida «enséñale a hacer esto siempre así».
metadata:
  colmena:
    bot: atlas
    adaptada_de: "OpenClaw skills/skill-creator (Apache-2.0)"
---

# Guía de calidad para crear habilidades

Una habilidad es un procedimiento que un bot sigue igual cada vez. Antes de activarse pasa unos controles (cabecera válida, «Úsala cuando…», herramientas que existen, tamaño, que no repita otra y que no lleve secretos); después la usa desde ya y la persona la ve con «Deshacer». Los bots en «Solo sugiere», las mejoras de una habilidad apagada y las que repiten otra esperan su revisión.

1. Fija el contrato. Reúne dos o tres casos reales en los que se usaría. Separa los caminos de verdad distintos de las formas de decir lo mismo. Hecho cuando cada camino tiene un disparador concreto, un resultado esperado y dónde se guarda (entregable, memoria, archivo).
2. Escribe la cabecera:
   - `name`: corto y con verbo o tema («Resumir enlaces y documentos»).
   - `description`: empieza por «Úsala cuando…» y nombra las situaciones y palabras que la disparan; máx. 300 caracteres.
   - `metadata.colmena.bot` si es de un bot concreto.
   Hecho cuando solo leyendo la descripción se sabe si toca usarla.
3. Escribe el cuerpo como pasos numerados que empiezan por un verbo. Cada paso termina con un criterio comprobable («Hecho cuando…»). El último paso es siempre una comprobación del resultado.
4. Nombra solo herramientas que existen en Colmena (`read_file`, `web_fetch`, `create_deliverable`, `ask_user`, `fill_pdf`, `create_image`…) y respeta las líneas rojas: enviar fuera, mover dinero, borrar e instalar siempre piden permiso. Una habilidad nunca concede permisos.
5. Escribe para alguien no técnico: frases cortas, ejemplos reales, sin jerga. Nada de secretos, datos personales ni cosas que solo valen para hoy.
6. Valida antes de proponerla:
   - La cabecera es YAML válido con name y description.
   - Cada paso se puede seguir sin adivinar; no hay dos pasos que digan lo mismo.
   - Pruébala mentalmente con uno de los casos del paso 1: ¿sale el resultado esperado?
7. Si se parece mucho a una habilidad que ya existe, mejora esa en vez de crear otra. Explica qué cambia respecto a la versión anterior en una o dos frases.
