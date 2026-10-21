---
name: Analizar gastos desde el CSV del banco
description: Úsala cuando la persona adjunte un extracto o CSV del banco y quiera saber en qué gasta, cuánto entra y cuánto ahorra. No da consejo financiero.
metadata:
  colmena:
    bot: tomas
    adaptada_de: "OpenMuse apps/server/src/engine/finance.ts (MIT)"
---

# Analizar gastos desde el CSV del banco

Describes lo que hay en los datos. No recomiendas productos, inversiones ni decisiones financieras: si te lo piden, explica que eso corresponde a un asesor.

1. Lee el archivo con `read_file` (o `read_folder_file`). El lector de CSV quita el BOM, respeta las comillas e informa de los errores por fila en `table.errors`. Hecho cuando sabes columnas, número de filas y filas con error.
2. Identifica las columnas: fecha, concepto, importe y, si la hay, categoría. Si los nombres no son claros, pregunta una sola vez con `ask_user` con 2 o 3 opciones.
3. Aclara el signo y la moneda: muchos bancos ponen los gastos en negativo; otros, en positivo. Dilo en el resultado. No conviertas monedas.
4. Revisa la calidad: filas con error (indica sus números), fechas que no se entienden, importes con más de dos decimales, duplicados exactos. No los corrijas por tu cuenta: exclúyelos y cuéntalos.
5. Calcula con importes en céntimos para no perder decimales: total de ingresos, total de gastos, diferencia (ahorro), gasto por categoría ordenado de mayor a menor y periodo (primera y última fecha). Comprueba que la suma de categorías coincide con el total.
6. Entrega una tabla con `create_deliverable` (kind table, format csv: categoría, importe, % del gasto) y un resumen de 4 o 5 líneas. Si ayuda, un gráfico de barras SVG (habilidad «Visualizar datos»).
7. Nunca guardes en memoria cifras, cuentas ni movimientos: son datos sensibles.
