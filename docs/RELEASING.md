# Cómo sacar una versión de Colmena

Una versión es un tag `v*` en GitHub. Al subirlo, GitHub Actions (`.github/workflows/release.yml`):

1. comprueba que el tag coincide con `version` de `package.json`;
2. crea un borrador de release con las notas generadas a partir de los commits;
3. pasa las pruebas (`npm test`);
4. construye el instalador de Windows (NSIS, x64) en `windows-latest` y los de Mac (dmg y zip, Intel y Apple Silicon) en `macos-latest`;
5. arranca cada app empaquetada y comprueba que su servidor responde (`scripts/smoke-packaged.mjs`);
6. sube los instaladores y los ficheros de actualización (`latest*.yml`, `beta*.yml`, `*.blockmap`) a la release;
7. publica la release. Desde ese momento las Colmena instaladas la encuentran solas.

## Pasos

```bash
npm version 2.1.0 --no-git-tag-version   # o edita "version" en package.json
git commit -am "Release 2.1.0"
git tag v2.1.0
git push origin main --tags
```

Sigue el progreso en la pestaña **Actions** del repositorio. Si algo falla, la release se queda en borrador: nadie la recibe. Arregla, borra el tag (`git push --delete origin v2.1.0` y `git tag -d v2.1.0`) y vuelve a empezar.

Para corregir las notas de una versión, edítalas en GitHub (Releases › Edit). Son las que ve la gente en Ajustes › Actualizaciones › «Novedades de la 2.1.0».

## Canal beta

Una versión con guion es beta: `2.1.0-beta.1` → tag `v2.1.0-beta.1`. Se publica como *pre-release* y solo la reciben quienes eligen **Beta** en Ajustes › Actualizaciones. Las versiones estables también llegan al canal beta cuando son más nuevas.

## Cómo se actualiza una Colmena instalada

`desktop/updater.cjs` usa electron-updater con GitHub Releases:

- busca 10 s después de arrancar, cada 4 h y al despertar el ordenador;
- descarga en segundo plano y, al terminar, muestra «Hay una versión nueva · Reiniciar para actualizar»;
- instala al pulsar «Reiniciar» o al salir de Colmena;
- si hay una misión en marcha, «Reiniciar» espera a que el equipo termine;
- el registro está en `%APPDATA%\Colmena\logs\updates.log` (Mac: `~/Library/Application Support/Colmena/logs/updates.log`).

El repositorio tiene que ser **público** para que las apps instaladas lean las releases sin credenciales.

### Probar una actualización sin publicar

1. Construye e instala la versión A (`npm run dist:win` y ejecuta `release/Colmena-A-win-x64.exe`).
2. Sube la versión en `package.json`, vuelve a construir (`npm run dist:win`) y sirve la carpeta `release/` en local, por ejemplo con `npx http-server release -p 8765`.
3. Arranca la Colmena instalada apuntando a ese feed:
   ```powershell
   $env:COLMENA_UPDATE_FEED = "http://127.0.0.1:8765/"
   & "$env:LOCALAPPDATA\Programs\Colmena\Colmena.exe"
   ```
4. A los 10 s aparece el aviso; «Reiniciar para actualizar» instala y vuelve a abrir la nueva versión.

## Firma de código

Sin firma los instaladores funcionan, pero el sistema avisa:

- **Windows**: SmartScreen muestra «Windows protegió su PC» la primera vez. Hay que pulsar «Más información › Ejecutar de todas formas». Las actualizaciones automáticas funcionan igual.
- **Mac**: Gatekeeper dice que no puede comprobar el desarrollador. Hay que abrir Colmena una vez desde Ajustes del Sistema › Privacidad y seguridad › «Abrir igualmente». Sin firma, macOS **no deja que la app se actualice sola**: el aviso ofrece «Descargar» y se instala a mano.

Para firmar, añade estos secretos en GitHub (Settings › Secrets and variables › Actions). El flujo los usa en cuanto existen:

| Secreto | Qué es |
| --- | --- |
| `WIN_CSC_LINK` | Certificado de firma de código de Windows (.pfx) en base64 |
| `WIN_CSC_KEY_PASSWORD` | Contraseña del .pfx |
| `MAC_CSC_LINK` | Certificado «Developer ID Application» (.p12) en base64 |
| `MAC_CSC_KEY_PASSWORD` | Contraseña del .p12 |
| `APPLE_ID` | Apple ID de la cuenta de desarrollador (para notarizar) |
| `APPLE_APP_SPECIFIC_PASSWORD` | Contraseña específica de app de ese Apple ID (appleid.apple.com) |
| `APPLE_TEAM_ID` | ID del equipo de desarrollador (10 caracteres) |

Para pasar un certificado a base64: `base64 -i certificado.p12 | pbcopy` en Mac o `[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificado.pfx")) | Set-Clipboard` en PowerShell.

Los certificados de Windows con validación extendida (EV) suelen ir en un token USB o en un servicio en la nube (Azure Trusted Signing, SSL.com eSigner) y necesitan otra configuración de `win.signtoolOptions` o `win.azureSignOptions`.

## Construir en local

```bash
npm ci
npm run dist:win     # Windows: release/Colmena-<versión>-win-x64.exe
npm run dist:mac     # Mac (solo en un Mac): dmg y zip
npm run dist:dir     # sin instalador, solo la carpeta de la app (más rápido)
node scripts/smoke-packaged.mjs   # arranca el servidor de la app empaquetada
```
