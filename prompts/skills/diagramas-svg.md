---
name: Diagramas en SVG
description: Úsala cuando haya que explicar un proceso, una organización, un flujo, una arquitectura o un mapa de conceptos con un diagrama.
metadata:
  colmena:
    bot: iris
    adaptada_de: "OpenClaw skills/diagram-maker (MIT)"
---

# Diagramas en SVG

Un diagrama es un entregable, no un párrafo.

1. Extrae los elementos: nodos, grupos, etiquetas y relaciones con dirección. Quédate con 5 a 9 elementos principales; si hay más, agrupa. Hecho cuando tienes la lista escrita.
2. Elige la disposición antes de dibujar: de izquierda a derecha (procesos), de arriba abajo (jerarquías), radial (un centro y sus partes), carriles (quién hace qué) o capas.
3. Dibuja un único SVG autónomo:
   - `viewBox` y ancho 100 %; sin fuentes, imágenes, scripts ni recursos externos; sin degradados ni adornos.
   - Colores con significado, no un arcoíris: neutro (#E6E8EE), entrada (#DCE6FF), proceso (#E5DDFF), almacén (#D6F5EA), externo (#FFF1C7), riesgo (#FFDCD6); texto #12131A.
   - Primero las flechas y luego las cajas, para que las flechas queden detrás. Cada `path` de conexión con `fill="none"` y punta de flecha si tiene dirección.
   - 24 px de margen interior en las cajas; el texto no toca los bordes. Etiquetas cortas.
   - Leyenda solo si los colores o símbolos no son evidentes.
   Hecho cuando el SVG es XML válido (todas las etiquetas cerradas).
4. Guárdalo con `create_deliverable` (kind design, format svg) y un título claro.
5. Comprueba: ¿se entiende sin explicación? ¿Cada flecha dice qué pasa? Si no, simplifica y guarda una versión nueva con el mismo título.

Si la persona necesita una ilustración y no un esquema, usa `create_image` en su lugar.
