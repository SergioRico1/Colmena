---
name: Probar una idea antes de construirla
description: Úsala cuando la persona quiera saber si algo es posible, comparar dos caminos o hacer un prototipo rápido («spike») antes de construir en serio.
metadata:
  colmena:
    bot: bruno
    adaptada_de: "OpenClaw skills/spike (MIT)"
---

# Probar una idea antes de construirla

No la uses si leer la documentación responde la pregunta, ni cuando la persona ya pidió la versión definitiva.

1. Pregunta: escribe en una frase la duda concreta («¿Se puede leer el PDF de facturas y sacar el total?»). Hecho cuando la pregunta tiene un sí o un no posible.
2. Investiga lo justo: documentación o código con `web_fetch` o los archivos de la misión, para elegir un enfoque creíble.
3. Construye lo mínimo que lo demuestre: un script corto, un HTML pequeño o una prueba. Guárdalo con `write_file` en la carpeta de la misión (`spikes/<nombre>/`) con un README de tres líneas. Nada de instalar paquetes ni tocar el sistema.
4. Fuérzalo: prueba un caso límite o un fallo probable.
5. Veredicto con esta forma, guardado con `create_deliverable` (kind document, format md):
   - **Veredicto**: VALIDADA, PARCIAL o DESCARTADA.
   - Pregunta. Evidencia (lo que ejecutaste o mediste, literal). Qué funcionó. Qué falló o sorprendió.
   - Recomendación: seguir, ajustar o descartar, y el siguiente paso real.
6. Distingue lo que ejecutaste de lo que supones. Una idea descartada con pruebas también es un buen resultado.

El código de una prueba no pasa a producción sin reescribirlo bien. Si evalúas una dependencia externa, mira su licencia, su última versión y su documentación.
