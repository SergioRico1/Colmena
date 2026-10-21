---
name: Crear documentos de Word que se leen de un tirón
description: Úsala cuando te pidan un documento, un informe, una carta, un acta, una propuesta, un contrato o «pásalo a Word», también a partir de notas, correos, un PDF o una conversación.
metadata:
  colmena:
    adaptada_de: "Anthropic docx skill y OpenAI documents skill (docx nativo, estilos de título reales, revisión visual del PDF)"
---

# Crear documentos de Word que se leen de un tirón

Un documento es para leerlo de arriba abajo y encontrar lo importante sin buscarlo. Se hace con `create_document`, nunca con `create_deliverable`.

1. Reúne el material antes de escribir: lee los archivos, correos o páginas que importan. Hecho cuando cada dato, cifra o nombre sale de algo que has leído (nunca lo inventes).
2. Escribe el esqueleto: el título dice de qué va y para quién; las secciones son `heading` de nivel 1 y, dentro, nivel 2 o 3. Hecho cuando leyendo solo los títulos se entiende el documento.
3. Empieza por la conclusión: en un informe, el primer bloque tras el título es un resumen de 3-5 líneas o un `callout` (tone `success` o `warning`) con lo que hay que saber o decidir.
4. Párrafos cortos (3-5 líneas), una idea cada uno. Usa **negrita** solo para lo que no se puede pasar por alto y enlaza las fuentes con [texto](https://…).
5. Elige el bloque por lo que cuentas: pasos u orden → `numbered`; opciones o hallazgos sueltos → `bullets`; datos exactos para comparar → `table` (cabecera clara, unidades en la cabecera, pocas columnas); una evolución → `chart` con los valores reales; una frase textual de alguien → `quote`.
6. Imágenes solo si aportan: créalas antes con `create_image` y pasa su ruta en `image` con un `caption` que diga qué se ve.
7. Formato según el uso: carta o nota breve → `cover: "none"`, sin secciones; informe largo → `cover: "page"` y `page_break` entre partes grandes; lo demás, `cover: "header"`. Pon `author` y `date` si los sabes. Tema `sobrio` para empresa, `calido` para algo cercano.
8. Si devuelve `avisos`, corrígelos y vuelve a llamarla con el mismo título (queda como versión nueva).
9. Termina con una o dos frases: qué es el documento, cuántas páginas tiene y que se puede abrir, descargar en Word o en PDF. No repitas su contenido en el chat.
