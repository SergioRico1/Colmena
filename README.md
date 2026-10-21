# Colmena

Tu equipo de bots de IA, en tu propio ordenador. Colmena es una app de escritorio (Windows y Mac) donde varios bots trabajan contigo: chatean, se reparten encargos, usan tus apps conectadas y un navegador propio, y te piden permiso solo para lo que sale de tu ordenador (enviar, pagar, publicar, borrar).

Funciona con tu cuenta de ChatGPT, Claude (Claude Code, token de suscripción o clave de API) u OpenCode Go. Tus datos se quedan en este ordenador.

## Instalar

Descarga la última versión en [Releases](https://github.com/SergioRico1/Colmena/releases/latest):

- **Windows**: `Colmena-<versión>-win-x64.exe`. Se instala solo para ti, sin permisos de administrador (puedes elegir «para todos los usuarios»). Si Windows muestra «Windows protegió su PC», pulsa **Más información › Ejecutar de todas formas**: aparece mientras el instalador no esté firmado.
- **Mac**: `Colmena-<versión>-mac-arm64.dmg` (Apple Silicon) o `-mac-x64.dmg` (Intel). Arrastra Colmena a Aplicaciones. Si macOS dice que no puede comprobar el desarrollador, ábrela una vez desde **Ajustes del Sistema › Privacidad y seguridad › Abrir igualmente**.

Colmena se actualiza sola: cuando hay una versión nueva la descarga en segundo plano y te avisa con «Hay una versión nueva · Reiniciar para actualizar». En **Ajustes › Actualizaciones** puedes buscar actualizaciones y elegir el canal (estable o beta).

Tus bots, chats y cuentas se guardan en `%LOCALAPPDATA%\Colmena` (Windows) o `~/.local/share/Colmena` (Mac). Desinstalar no los borra.

## Desarrollo

Necesitas Node.js 24 y npm.

```bash
npm install
npm run desktop   # la app de escritorio (Electron) con el servidor local
npm run dev       # solo servidor + interfaz con recarga, en http://127.0.0.1:4317
npm test          # pruebas
npm run build     # interfaz de producción en dist/
```

- `desktop/`: proceso principal de Electron (ventana, bandeja, navegador de los bots, actualizador).
- `server/`: servicio local (Node 24, Express 5, `node:sqlite`) con el runtime de los bots.
- `src/`: interfaz (React 19 + Vite). `design/` es la fuente de verdad del diseño; `npm run design` la convierte en `src/design/`.
- `prompts/`: alma, reglas y habilidades iniciales de los bots.
- `docs/`: arquitectura (`ARCHITECTURE.md`), contrato de la API (`CONTRACT.md`), proveedores, uso del ordenador.

Para probar con datos aislados: `COLMENA_DATA_DIR=.local/qa-data` (datos) y `COLMENA_USER_DATA=.local/qa-profile` (perfil de escritorio).

## Instaladores y versiones

`npm run dist:win` genera el instalador de Windows en `release/`; `npm run dist:mac`, los de Mac (en un Mac). Las versiones oficiales salen de GitHub Actions al subir un tag `v*`: [docs/RELEASING.md](docs/RELEASING.md).

## Licencia

Todos los derechos reservados: el código se puede leer, pero no usar ni reutilizar sin permiso ([LICENSE](LICENSE)). Colmena incluye código de otros proyectos (OpenClaw, OpenMuse, NEXO…): [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
