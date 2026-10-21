---
name: Crear presentaciones que se entienden solas
description: Úsala cuando te pidan una presentación, unas diapositivas, un deck o «pásalo a PowerPoint», también a partir de un Excel, un informe o una conversación.
metadata:
  colmena:
    adaptada_de: "OpenAI slides skill y Anthropic pptx skill (pptxgenjs, revisión visual de cada diapositiva)"
---

# Crear presentaciones que se entienden solas

Una presentación es un argumento, no un documento troceado. Se hace con `create_presentation`, nunca con `create_deliverable`.

1. Reúne los datos antes de escribir: lee los archivos, correos o páginas que importan. Hecho cuando cada cifra que vas a poner sale de algo que has leído (nunca inventes números ni nombres).
2. Escribe primero el hilo en una frase por diapositiva (entre 6 y 12 casi siempre): portada → contexto → 3-6 ideas → qué hacer → cierre. Hecho cuando leyendo solo los títulos se entiende la historia.
3. Cada título dice la conclusión («Los marketplaces ya son la mitad de los pedidos»), no el tema («Canales»).
4. Elige el diseño por lo que tienes que contar: una cifra que impresiona → `stats`; una evolución o comparación → `chart` con los valores reales y su lectura en `subtitle`; dos opciones o un antes/después → `two_columns`; datos exactos → `table` (pocas filas); una frase de alguien → `quote`; un cambio de bloque → `section`. No pongas todo en `bullets`.
5. Puntos cortos: 3-5 por diapositiva y unas 12 palabras cada uno. Lo que sobre va a `notes` (notas del orador).
6. Imágenes solo si aportan: créalas antes con `create_image` (horizontal, 1536x1024, sin texto dentro) y pasa su ruta en `image`.
7. Tema: `sobrio` para empresa o finanzas, `colmena` para el día a día, `noche` para eventos, `calido` para algo cercano. Si sabes el color de la marca, ponlo en `accent`.
8. Lee los `avisos` que devuelve: si algo no cabe, recórtalo o divídelo y vuelve a llamar con el mismo título (queda como versión nueva). Hecho cuando no quedan avisos.
9. Termina con una o dos frases: qué cuenta la presentación y que se puede abrir, descargar en PowerPoint o en PDF. No repitas el contenido de las diapositivas en el chat.
