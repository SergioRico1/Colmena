---
name: Crear hojas de cálculo de Excel que siguen funcionando
description: Úsala cuando te pidan un Excel, una hoja de cálculo, un presupuesto, un listado, un control de gastos o una tabla con la que la persona vaya a trabajar, también a partir de un CSV, un PDF o unos correos.
metadata:
  colmena:
    adaptada_de: "Anthropic xlsx skill y OpenAI spreadsheets skill (fórmulas en vez de valores, cero errores de fórmula, formatos por tipo)"
---

# Crear hojas de cálculo de Excel que siguen funcionando

Una hoja de cálculo es una herramienta: si la persona cambia un número, todo lo que depende de él tiene que cambiar. Se hace con `create_spreadsheet`, nunca con `create_deliverable`.

1. Reúne los datos con su origen. Si vienen de un CSV de la misión, cárgalo con `rows_from` en vez de copiar las filas. Hecho cuando cada cifra sale de algo que has leído (nunca la inventes).
2. Diseña las hojas: una pestaña de datos por tema y, si hay que sacar conclusiones, una pestaña «Resumen» que tire de las otras con fórmulas ('Datos'!D12). Nombres de pestaña cortos.
3. Columnas con su tipo: `currency` para dinero, `percent` para porcentajes (en fracción: 0,25), `date` para fechas («2026-10-19»), `integer` para unidades, `text` para lo demás. La cabecera dice qué es y, si hace falta, la unidad.
4. Fórmulas de verdad, nunca resultados calculados por ti: lo que se calcula por fila va en `formula` de la columna («=C{r}*D{r}», dejando esa celda a null); los totales con `total` (sum, average…); el resto en celdas «=…». Recuerda: la fila 1 es la cabecera, los datos empiezan en la 2 y la fila de totales va justo después de la última. Funciones en inglés y comas.
5. Supuestos aparte: tipos de IVA, comisiones o tipos de cambio van en una celda propia (por ejemplo en «Resumen») y las fórmulas apuntan a ella con $ ($B$2), no escritos dentro de cada fórmula.
6. Formato condicional solo si ayuda a leer: `negative` en rojo (`bad`) para saldos, `data_bar` para comparar importes, `greater`/`less` para umbrales que la persona te haya dicho.
7. Un gráfico solo si enseña algo que la tabla no: una evolución (`line`) o una comparación (`column`/`bar`), de una hoja con pocas filas (un resumen, no los 300 movimientos).
8. Si te devuelve un error de fórmula (#REF!, #DIV/0!, #NAME?, #VALUE!), corrige esa celda y vuelve a llamar. Si una división puede quedar vacía a propósito, usa IFERROR(…,""). Si devuelve `avisos`, corrígelos con el mismo título (versión nueva).
9. Termina con una o dos frases: qué hojas tiene, qué calcula y que se puede abrir y descargar en Excel. No pegues la tabla en el chat.
