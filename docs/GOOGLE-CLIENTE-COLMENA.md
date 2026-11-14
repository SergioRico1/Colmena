# El cliente de Google de Colmena: lista para el propietario (una sola vez)

Colmena tendrá **un único cliente OAuth de Google para todo el producto**, creado por el propietario
en el proyecto de Google Cloud de Colmena. Cada persona da permiso con su propia cuenta de Google; las
empresas no crean nada en Google Cloud.

Regla fija: **solo permisos sensibles o no sensibles**. Esos necesitan la verificación estándar de
Google (marca + permisos sensibles), **sin evaluación de seguridad CASA**. Los permisos
**restringidos** (Gmail de lectura/borradores, Drive completo, Google Ads…) exigen CASA anual y
Colmena no los pide: el servidor los rechaza (`RESTRICTED_SCOPES` en `server/mcp/google.mjs`).

Hasta que este cliente exista, las entradas de Google del Marketplace dicen «Disponible pronto».

## Qué permisos son de cada tipo (comprobado el 14 de noviembre de 2026)

| Permiso | Tipo | Fuente |
| --- | --- | --- |
| `gmail.readonly`, `gmail.compose`, `gmail.modify` | **Restringido** | https://developers.google.com/workspace/gmail/api/auth/scopes |
| `gmail.send` | Sensible | ídem |
| `gmail.labels` | No sensible | ídem |
| `drive`, `drive.readonly` | **Restringido** | https://developers.google.com/workspace/drive/api/guides/api-specific-auth |
| `drive.file` | No sensible | ídem |
| `spreadsheets`, `documents`, `presentations` (y sus `.readonly`) | Sensible | https://developers.google.com/workspace/sheets/api/scopes · https://developers.google.com/workspace/docs/api/auth · https://developers.google.com/workspace/slides/api/scopes |
| `chat.messages.readonly` | **Restringido** | https://developers.google.com/workspace/chat/authenticate-authorize |
| `chat.messages.create`, `chat.spaces.readonly`… | Sensible | ídem |
| `adwords` (Google Ads) | **Restringido** | https://developers.google.com/google-ads/api/docs/productionize/secure-credentials |
| Calendar, `analytics.readonly`, `bigquery`, `contacts.readonly` | Sin clasificación publicada en su página; Google pone «leer los eventos de Calendar» como ejemplo de permiso sensible | https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification |

La consola de Google Auth Platform muestra la clasificación de cada permiso al añadirlo: compruébala
ahí antes de pedir la verificación.

## Qué conectará este cliente

| Entrada | Permisos | ¿Posible sin CASA? |
| --- | --- | --- |
| Google Analytics (servidor oficial que ejecuta Colmena) | `analytics.readonly` | Sí, si la consola lo marca sensible (esperado). |
| BigQuery (servidor MCP remoto de Google, sin «preview») | `bigquery` | Sí, si la consola lo marca sensible. |
| Google Calendar, Docs, Sheets, Slides, People, Drive (servidores MCP de Workspace) | sus guías piden también `drive.readonly` (restringido) y están en **Developer Preview** | **No por ahora**: las condiciones del programa prohíben dar acceso a usuarios fuera de tu propia empresa antes de que sean de uso general (https://developers.google.com/workspace/preview). La inscripción es por cuenta de Workspace y número de proyecto de Cloud, no por usuario. |
| Gmail (servidor MCP de Google) | `gmail.readonly` + `gmail.compose` | **No**: restringidos. Gmail va por contraseña de aplicación (docs/GMAIL-CONTRASENA-APLICACION.md) o por Composio. |
| Google Ads | `adwords` | **No**: restringido. |

## Lista, en orden

1. **Proyecto.** En https://console.cloud.google.com crea (o elige) el proyecto «Colmena», de la
   organización de Colmena. Apunta su **ID de proyecto**.
2. **APIs.** Activa: Google Analytics Admin API, Google Analytics Data API, BigQuery API (y, cuando
   los servidores de Workspace sean de uso general, las suyas y sus servicios MCP).
3. **Dominio.** Verifica `colmena.team` en Google Search Console con una cuenta que sea propietaria
   del proyecto.
4. **Google Auth Platform › Marca** (pantalla de consentimiento):
   - Nombre de la app: **Colmena**; logotipo (120×120, el hexágono de Colmena);
   - correo de asistencia y de contacto del desarrollador;
   - página principal: **https://colmena.team** (tiene que explicar qué es Colmena y enlazar la
     política de privacidad; no puede ser solo una página de entrar);
   - política de privacidad: **https://colmena.team/privacidad** (completa antes los `[PENDIENTE]`);
   - dominios autorizados: `colmena.team`.
5. **Público:** **Externo**. Mientras está «En pruebas» solo pueden entrar hasta 100 usuarios de
   prueba y **sus permisos caducan a los 7 días** (https://support.google.com/cloud/answer/15549945):
   úsalo solo para grabar el vídeo. Después, **Publicar app**.
6. **Acceso a datos (permisos):** añade `openid`, `email`, `analytics.readonly` y `bigquery`. Nada
   restringido. Para cada uno, la justificación (en inglés, la revisa Google):
   - `analytics.readonly`: «Colmena's bots read the user's own Google Analytics 4 reports (traffic,
     conversions, real-time) when the user asks, to answer questions and prepare summaries. Read-only;
     no narrower scope exists for the Data API.»
   - `bigquery`: «The user's bots run SQL queries the user requests against the user's own BigQuery
     datasets through Google's BigQuery MCP server. Write queries always require the user's explicit
     approval in Colmena.»
7. **Clientes** (Google Auth Platform › Clientes):
   - **Aplicación web** «Colmena nube», URI de redirección autorizada:
     `https://app.colmena.team/api/mcp/oauth/callback`.
   - **App de escritorio** «Colmena escritorio» (vuelve a `http://127.0.0.1:<puerto>/callback`, que
     Google solo permite a este tipo de cliente).
8. **Vídeo de demostración** (YouTube, oculto): muestra la pantalla de consentimiento con el ID de
   cliente visible en la barra de direcciones, cada permiso pedido y qué hace Colmena con él (un bot
   leyendo un informe de Analytics; una consulta de BigQuery que espera tu aprobación).
9. **Pide la verificación** en Google Auth Platform › Centro de verificación. Google dice que puede
   tardar hasta 10 días. No hay evaluación de seguridad para permisos sensibles
   (https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).
10. **Configura Colmena:**
    - Nube: `wrangler secret put COLMENA_GOOGLE_CLIENT_ID`, `COLMENA_GOOGLE_CLIENT_SECRET` y
      `COLMENA_GOOGLE_PROJECT` en el Worker `colmena-nube`.
    - Escritorio: `COLMENA_GOOGLE_DESKTOP_CLIENT_ID`, `COLMENA_GOOGLE_DESKTOP_CLIENT_SECRET` y
      `COLMENA_GOOGLE_PROJECT` en el entorno del proceso servidor (o en la configuración de la
      distribución).
    - Las entradas de Google dejan de decir «Disponible pronto» solas.

Para cada empresa cliente con Google Workspace: si quien administra tiene restringido el acceso de
apps de terceros, tendrá que marcar el ID de cliente de Colmena como «De confianza» en la consola de
administración (por defecto se permite).
