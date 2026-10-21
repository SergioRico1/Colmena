---
name: Visualizar datos en tabla o gráfico
description: Úsala cuando haya cifras que comparar o una evolución que enseñar y una tabla o un gráfico lo expliquen mejor que un texto.
metadata:
  colmena:
    bot: tomas
    adaptada_de: "OpenClaw skills/visualize (MIT)"
---

# Visualizar datos en tabla o gráfico

1. Reúne los datos con su origen (archivo y página, hoja, web). Si falta un dato, déjalo vacío y dilo; nunca lo inventes ni lo «redondees» para que quede bonito. Hecho cuando cada cifra tiene fuente y unidad.
2. Elige la forma:
   - Pocas filas o valores exactos → tabla (`create_deliverable`, kind table, format csv).
   - Comparar categorías → barras horizontales. Evolución en el tiempo → línea. Partes de un total (máx. 5) → barra apilada, no tarta.
3. Para un gráfico, dibuja un SVG autónomo (`create_deliverable`, kind design, format svg):
   - Ejes con unidad y escala que empiece en cero en las barras; etiquetas legibles (mín. 12 px).
   - Cada serie con color y además etiqueta o forma (no solo color). Título que diga la conclusión, p. ej. «Las ventas de octubre suben un 8 %».
   - Sin scripts, imágenes ni fuentes externas.
   Hecho cuando las barras o puntos están a escala con los números.
4. Calcula con cuidado: suma y comprueba totales dos veces; indica si los datos son reales, estimados o de ejemplo.
5. Entrega con dos o tres frases: qué muestra, qué conclusión sale y qué límites tienen los datos.
