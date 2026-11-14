# Google Analytics y Google Ads en Colmena

Google publica servidores MCP oficiales **de código abierto** para Analytics y para Ads, pero no los
aloja: hay que ejecutarlos. Colmena los ejecuta por ti, para cada persona con su propia cuenta de
Google:

- **en la nube**, dentro de la máquina de tu empresa (el contenedor de la fase 4), instalados en la
  imagen (`/opt/mcp/bin/analytics-mcp`, `/opt/mcp/bin/google-ads-mcp`, versiones fijadas);
- **en el escritorio**, como un proceso hijo de tu ordenador (`pipx run --spec analytics-mcp==1.1.0
  analytics-mcp`; necesitas Python 3.10+ y pipx).

Se autentican con el cliente OAuth de Colmena (docs/GOOGLE-CLIENTE-COLMENA.md) y el permiso que da
cada persona: Colmena construye unas credenciales de tipo `authorized_user` (lo mismo que escribe
`gcloud auth application-default login`) solo en una carpeta privada del proceso mientras se
ejecuta, y las borra al pararlo. Nunca se escriben en otro sitio.

## Estado hoy (verificado el 14 de noviembre de 2026)

| | Estado en Colmena | Por qué |
| --- | --- | --- |
| Google Analytics | **Disponible pronto** | Funciona en cuanto exista el cliente de Google de Colmena. Permiso `analytics.readonly`. |
| Google Ads | **Disponible pronto** (bloqueado) | Google clasifica el permiso de Ads como **restringido**: exige la evaluación de seguridad anual (CASA), que Colmena no va a hacer. |

Mientras tanto, Google Ads se puede conectar en «Otras apps (Composio)» con tu cuenta de Composio.

## Google Analytics

- Repositorio: https://github.com/googleanalytics/google-analytics-mcp (paquete PyPI `analytics-mcp`,
  versión fijada 1.1.0).
- Credenciales: Application Default Credentials con `https://www.googleapis.com/auth/analytics.readonly`.
  Colmena pasa `GOOGLE_APPLICATION_CREDENTIALS` (el archivo temporal) y `GOOGLE_CLOUD_PROJECT` (el
  proyecto de Colmena).
- Herramientas: resúmenes de cuentas y propiedades, `run_report`, informes en tiempo real y de
  embudo, metadatos. **Solo lectura**: las herramientas que escriben (`create_property_annotation`,
  `create_custom_dimension`, `create_key_event`) necesitan `--allow-write` y `analytics.edit`, que
  Colmena no activa.
- Requisitos de la persona: acceso de lectura a la propiedad de GA4 con su cuenta de Google.
- Requisitos del proyecto de Colmena: activar la **Google Analytics Admin API** y la **Google
  Analytics Data API**.

Para conectar (cuando esté disponible): Ajustes › Apps y carpetas › Marketplace › Google Analytics ›
«Conectar Google Analytics», eliges tu cuenta de Google y aceptas.

## Google Ads

- Repositorio: https://github.com/googleads/google-ads-mcp (paquete `google-ads-mcp`, versión fijada
  0.0.6, instalado en la imagen de la máquina).
- Credenciales: Application Default Credentials con `https://www.googleapis.com/auth/adwords`;
  variables `GOOGLE_PROJECT_ID` y, para cuentas bajo un administrador, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.
- Herramientas: `search` (consultas GAQL), `list_accessible_customers`, metadatos de recursos; y de
  escritura (`create_asset`, `upload_video_asset`, etiquetas) con un paso de confirmación. Se puede
  dejar en solo lectura en `tools_config.yaml`.

Requisitos de Google (https://developers.google.com/google-ads/api/docs/api-policy/access-levels):

- **Ya no hace falta token de desarrollador**: «Developer tokens were sunset on September 9, 2026».
  El nivel de acceso a la API va ahora **por proyecto de Google Cloud** (el que emite las
  credenciales OAuth), y se pide en la consola sin cuenta de administrador (MCC).
- Niveles: **Test** (automático, solo cuentas de prueba), **Explorer** (el mínimo para cuentas
  reales, 2.880 operaciones al día, revisión normalmente automática), **Basic** (verificación de
  marca, 15.000 al día) y **Standard** (auditoría manual de unos 10 días hábiles, sin límite).
- Un solo proyecto (el de Colmena) puede servir a muchos anunciantes, cada uno con su permiso OAuth
  («multi-user authentication»: https://developers.google.com/google-ads/api/docs/oauth/overview).
- **Pero** el permiso `adwords` es **restringido**
  (https://developers.google.com/google-ads/api/docs/productionize/secure-credentials): una app
  externa en producción necesita verificación y la evaluación CASA anual. Por eso Colmena no lo
  ofrece con su cliente. Si algún día se hace CASA, basta con quitar el bloqueo de la entrada
  `google-ads` del catálogo (`server/mcp/catalog.mjs`).
