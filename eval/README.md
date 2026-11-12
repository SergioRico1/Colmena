# Evaluaciones de comportamiento

Los tests de `tests/` comprueban el código con un modelo de guion. Esto comprueba otra cosa: **cómo se portan los bots con un modelo de verdad**. ¿Contesta el correo o lo deja en borrador? ¿Envía sin que se lo pidan? ¿Obedece una orden escondida en una página? ¿Dice «enviado» sin haberlo enviado? ¿Hace el encargo entero?

Se lanza **a mano, antes de sacar una versión**. Nunca corre en `npm test`, `npm run verify` ni en CI (si la variable `CI` está puesta, se niega a arrancar).

## Qué hace

Cada caso (`eval/cases/<área>/*.json`) monta una Colmena nueva en una carpeta temporal, con el motor real (`Runtime`, las guardas de envío, el enrutador, la memoria, las Notas…) y un modelo real que decide. Todo lo que saldría fuera es un doble de pruebas: las apps conectadas (un Gmail, un calendario, una tienda… de mentira), la web (páginas escritas en el caso) y los archivos. No hay navegador, ordenador, MCP, Código ni Personas, y la red de ese proceso solo deja pasar al proveedor del modelo. **No se envía, compra ni publica nada real.**

Después comprueba, de lo más barato a lo más caro:

1. **Comprobaciones exactas** escritas en el caso: qué herramientas usó y con qué argumentos, qué quedó esperando tu OK, si un envío salió solo, a quién se enrutó, qué se guardó en memoria, qué dice la respuesta.
2. **Un juez** (otra llamada al modelo, con un criterio en español) solo donde hace falta leer la respuesta: «¿avisa de que no pudo?». Solo se le pregunta si lo anterior ya pasó.

Cada caso se ejecuta 3 veces y pasa con 2 de 3 (un modelo no responde siempre igual).

## Cómo se lanza

```
npm run eval -- --dry                      # prueba el arnés sin modelo ni cuenta (gratis, segundos)
npm run eval                               # todos los casos, con el modelo real
npm run eval -- --area email               # un área: email, redlines, honesty, router, memory, tools, notes, routines
npm run eval -- --case responder-en-el-hilo --runs 1
npm run eval -- --list                     # qué casos hay
```

Opciones: `--model <slug>` (el modelo de los bots), `--judge-model <slug>`, `--runs <n>`, `--max-cases <n>`, `--min 0.9` (mínimo de casos que deben pasar), `--yes` (no preguntar antes de gastar), `--data-dir <carpeta>`.

**Con qué cuenta piensa.** No usa tus datos de Colmena por defecto: tienes que decírselo tú, con una variable de entorno o con `--data-dir`. Sin ninguna, se niega y te lo recuerda.

| Variable | Qué usa |
| --- | --- |
| `COLMENA_EVAL_CLAUDE_CLI=1` | El Claude Code de este ordenador, con su propio inicio de sesión |
| `COLMENA_EVAL_ANTHROPIC_KEY` | Una clave de API de Anthropic |
| `COLMENA_EVAL_ANTHROPIC_TOKEN` | Un token de suscripción de Claude (`claude setup-token`) |
| `COLMENA_EVAL_OPENAI_KEY` | Una clave de API de OpenAI (añade `--model`) |
| `COLMENA_EVAL_OPENCODE_KEY` | Una clave de OpenCode Go |
| `COLMENA_EVAL_LOCAL_URL` + `COLMENA_EVAL_LOCAL_MODEL` | Un modelo local (Ollama…) |

En PowerShell: `$env:COLMENA_EVAL_CLAUDE_CLI = "1"; npm run eval -- --area email`.

`--data-dir <carpeta>` lee, sin escribir, la cuenta de IA de esa carpeta de datos de Colmena (claves de API, token de Claude o Claude Code). La sesión de ChatGPT no se usa desde ahí, porque renovarla cambiaría tus datos reales: para probar con ChatGPT usa una clave de API.

## Cuesta uso de tu plan

Una pasada completa son unas 35 conversaciones por 3, más las llamadas del juez. Antes de empezar dice cuántas llamadas y cuántos tokens calcula (una estimación gruesa) y pregunta si sigue; `--yes` se salta la pregunta. Para ir probando, usa `--area`, `--case`, `--max-cases` o `--runs 1`. El informe dice los tokens gastados por caso y en total.

## El informe

Al terminar imprime el resumen (cuántos pasan por área, los que fallan con la primera comprobación que falla y el motivo del juez) y deja en `eval/report/` (que no se sube al repositorio) un `.json` con todo —incluida la conversación de las ejecuciones que fallaron— y un `.md` para leer. Compara con el informe anterior: «3 casos que antes pasaban ahora fallan».

El comando termina con código 0 si pasa el mínimo (`--min`, 0.9 por defecto), 1 si no, y 2 si no llegó a ejecutarse.

## Añadir un caso

Copia uno parecido de `eval/cases/<área>/` y cambia:

- `id`, `area`, `title` y `why`: una línea que diga por qué importa y **cite el archivo de la regla** (`server/…`). Un caso prueba una regla que existe en el código.
- `setup`: `chat` (el bot) o `room` (`{bots, title}`), `bots` (cambios de autonomía o permisos), `settings`, `memory`, `wiki`, `files`, `web` (páginas), `apps` (cuentas y su contenido: `gmail.messages`, `fail` para que una acción falle…), `history` (lo ya dicho, con `ago` en segundos), `incognito`, `automation`.
- `turns`: lo que escribe la persona (`say`) y lo que hace después: `autoSend` (`"cancel"` cancela un envío antes de que salga), `decide` (aprobar o denegar algo), `answer` (contestar a una pregunta del bot). También `fire` (dispara la rutina), `returnNote` (recado al devolver el navegador), `stopAtRound` + `why` y `resume`.
- `checks`: las comprobaciones. La lista completa y los operadores están al principio de `eval/lib/checks.mjs`. Un `judge` lleva su `rubric` en español: qué tiene que cumplirse para pasar y qué no pasa.
- `runs` y `pass` (opcionales; 3 y 2).
- `dry.script`: lo que haría un bot que lo hace bien, paso a paso (`{"call": herramienta, "args": {…}}` o `{"say": "…"}`). Es lo que usa `--dry`, y con lo que `tests/eval-harness.test.mjs` comprueba que el caso está bien escrito.

Compruébalo con `npm run eval -- --dry --case <id>` antes de gastar una sola llamada.
