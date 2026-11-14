// The connections marketplace (docs/CONNECTIONS.md › Marketplace): one data-driven catalogue of
// what Colmena's bots can connect to, each entry checked against the vendor's own docs on the date
// in `verifiedAt` (sources in `sources`). Nothing here is a connector Colmena wrote for a vendor:
//
//   auth "oauth"     the vendor's remote MCP server with OAuth and dynamic client registration:
//                    Colmena registers itself and the person signs in with one click.
//   auth "token"     the vendor's remote MCP server with an API key or personal token the person
//                    (or the company) pastes; it travels in `token.header`.
//   auth "google"    Google's remote MCP servers and Google's official open-source servers
//                    (Analytics, Ads) with Colmena's own Google OAuth client, sensitive or
//                    non-sensitive scopes only (never a restricted one: no CASA assessment). Until
//                    that client exists (COLMENA_GOOGLE_CLIENT_ID/SECRET) they read «Disponible pronto».
//   auth "mail"      any mailbox over IMAP and SMTP with an app password (Gmail, Workspace, iCloud,
//                    Yahoo, Fastmail…): Colmena's built-in mail tools, credentials in the vault.
//   auth "composio"  Composio's managed apps (their verified Google app, among others), with the
//                    person's own Composio key or the company's.
//
// run: "remote" (an https MCP server), "local" (an official open-source server Colmena runs: a child
// process on the desktop, the company's machine in the cloud), "builtin" (in Colmena) or "composio".
// status: "stable", "beta" or "preview" (the vendor's word). `redLines`: the notable tools that send,
// publish, pay or delete: they always wait for the person's OK (server/mcp/tools.mjs › mcpPolicy).
// `perPerson`: each person connects their own account (never the company's for everyone).
// `listed: false`: kept so existing connections still reconnect, gone from the marketplace.

export const VERIFIED = "2026-11-14";

export const CATEGORIES = {
  mail: "Correo y calendario",
  documents: "Documentos y archivos",
  team: "Equipo y proyectos",
  sales: "Ventas y clientes",
  marketing: "Marketing y analítica",
  finance: "Pagos y facturas",
  development: "Desarrollo y datos",
  other: "Otras apps",
};

const remote = (id, fields) => ({ id, run: "remote", transport: "http", status: "stable", verifiedAt: VERIFIED, perPerson: false, listed: true, scopes: [], setup: [], redLines: [], ...fields });

export const CATALOG = [
  // ---------------------------------------------------------------- mail and calendar
  {
    id: "mail", vendor: "Colmena", name: "Correo (IMAP/SMTP)", logo: null, category: "mail", auth: "mail", run: "builtin", transport: "imap", status: "stable", verifiedAt: VERIFIED, perPerson: true, listed: true,
    description: "Tu buzón con una contraseña de aplicación: Gmail, Google Workspace, iCloud, Yahoo, Fastmail y casi cualquier proveedor.",
    can: { read: "Buscar correos, leer conversaciones y ver carpetas.", write: "Preparar borradores, mover y etiquetar correos." },
    redLines: ["Enviar un correo (siempre lo revisas tú antes)"],
    setup: [
      "Activa la verificación en dos pasos en tu cuenta de correo.",
      "Crea una contraseña de aplicación para Colmena (en Gmail: myaccount.google.com/apppasswords).",
      "Pégala aquí con tu dirección. Colmena la guarda cifrada y solo la usan tus bots.",
    ],
    guide: "docs/GMAIL-CONTRASENA-APLICACION.md",
    sources: ["https://support.google.com/accounts/answer/185833", "https://developers.google.com/workspace/gmail/imap/imap-smtp", "https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/"],
  },
  {
    id: "gmail", vendor: "Composio", name: "Gmail", logo: "gmail", category: "mail", auth: "composio", run: "composio", toolkit: "gmail", status: "stable", verifiedAt: VERIFIED, perPerson: true, listed: true,
    description: "Gmail completo con tu propia cuenta de Composio: buscar, leer, borradores y envíos que revisas tú.",
    can: { read: "Buscar y leer correos y conversaciones.", write: "Borradores, etiquetas y respuestas." },
    redLines: ["Enviar o responder un correo", "Borrar o mandar a la papelera"],
    thirdParty: "Los datos de Gmail pasan por Composio, un tercero.",
    setup: ["Crea tu cuenta gratuita en Composio.", "Pega tu clave de API de Composio.", "Pulsa «Conectar Gmail»: Google te pide el permiso en la app verificada de Composio."],
    sources: ["https://docs.composio.dev/docs/authenticating-tools", "https://composio.dev/pricing"],
  },
  {
    id: "googlecalendar", vendor: "Composio", name: "Google Calendar", logo: "googlecalendar", category: "mail", auth: "composio", run: "composio", toolkit: "googlecalendar", status: "stable", verifiedAt: VERIFIED, perPerson: true, listed: true,
    description: "Tu calendario de Google con tu cuenta de Composio: eventos, huecos libres e invitaciones.",
    can: { read: "Eventos y disponibilidad.", write: "Crear y cambiar eventos." },
    redLines: ["Invitar a otras personas", "Borrar un evento"],
    thirdParty: "Los datos de tu calendario pasan por Composio, un tercero.",
    setup: ["Crea tu cuenta gratuita en Composio.", "Pega tu clave de API de Composio.", "Pulsa «Conectar Google Calendar»."],
    sources: ["https://docs.composio.dev/docs/authenticating-tools"],
  },
  {
    id: "outlook", vendor: "Composio", name: "Outlook", logo: null, logoSite: "outlook.live.com", category: "mail", auth: "composio", run: "composio", toolkit: "outlook", status: "stable", verifiedAt: VERIFIED, perPerson: true, listed: true,
    description: "Correo y calendario de Microsoft con tu cuenta de Composio.",
    can: { read: "Correos y eventos.", write: "Borradores y eventos." },
    redLines: ["Enviar un correo", "Invitar o borrar"],
    thirdParty: "Los datos pasan por Composio, un tercero.",
    setup: ["Crea tu cuenta gratuita en Composio.", "Pega tu clave de API de Composio.", "Pulsa «Conectar Outlook»."],
    sources: ["https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/overview"],
  },
  remote("google-calendar-mcp", {
    vendor: "Google", name: "Google Calendar (MCP de Google)", logo: "googlecalendar", category: "mail", auth: "google", status: "preview", perPerson: true,
    endpoint: "https://calendarmcp.googleapis.com/mcp/v1",
    description: "El servidor MCP oficial de Google Calendar, con la cuenta de Google de cada persona.",
    can: { read: "Calendarios, eventos y huecos libres.", write: "Crear, cambiar y responder eventos." },
    scopes: ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events.freebusy", "https://www.googleapis.com/auth/calendar.events"],
    redLines: ["delete_event: borrar un evento", "Invitar a otras personas"],
    blocked: "Google solo deja usar sus servidores MCP de Workspace dentro de la propia empresa mientras estén en «Developer Preview». Llegará cuando sean de uso general; mientras, usa Google Calendar con Composio.",
    sources: ["https://developers.google.com/workspace/preview", "https://docs.cloud.google.com/mcp/supported-products", "https://developers.google.com/workspace/calendar/api/auth"],
  }),

  // ---------------------------------------------------------------- documents and files
  {
    id: "googledrive", vendor: "Composio", name: "Google Drive", logo: "googledrive", category: "documents", auth: "composio", run: "composio", toolkit: "googledrive", status: "stable", verifiedAt: VERIFIED, perPerson: true, listed: true,
    description: "Busca y lee tus archivos de Drive con tu cuenta de Composio.",
    can: { read: "Buscar y leer archivos.", write: "Crear y cambiar archivos." },
    redLines: ["Compartir un archivo", "Borrar"],
    thirdParty: "Los datos de Drive pasan por Composio, un tercero.",
    setup: ["Crea tu cuenta gratuita en Composio.", "Pega tu clave de API de Composio.", "Pulsa «Conectar Google Drive»."],
    sources: ["https://docs.composio.dev/docs/authenticating-tools"],
  },
  {
    id: "googlesheets", vendor: "Composio", name: "Google Sheets", logo: "googlesheets", category: "documents", auth: "composio", run: "composio", toolkit: "googlesheets", status: "stable", verifiedAt: VERIFIED, perPerson: true, listed: true,
    description: "Lee y escribe en tus hojas de cálculo con tu cuenta de Composio.",
    can: { read: "Leer hojas y rangos.", write: "Escribir celdas y filas." },
    redLines: ["Borrar hojas o filas"],
    thirdParty: "Los datos de tus hojas pasan por Composio, un tercero.",
    setup: ["Crea tu cuenta gratuita en Composio.", "Pega tu clave de API de Composio.", "Pulsa «Conectar Google Sheets»."],
    sources: ["https://docs.composio.dev/docs/authenticating-tools"],
  },
  remote("notion", { vendor: "Notion", name: "Notion", logo: "notion", category: "documents", auth: "oauth", endpoint: "https://mcp.notion.com/mcp", description: "Consulta y escribe en tus páginas y bases de datos.", can: { read: "Buscar y leer páginas y bases de datos.", write: "Crear y cambiar páginas, comentar." }, redLines: [], sources: ["https://developers.notion.com/docs/mcp"] }),
  remote("airtable", { vendor: "Airtable", name: "Airtable", logo: "airtable", category: "documents", auth: "oauth", endpoint: "https://mcp.airtable.com/mcp", description: "Bases, tablas y registros.", can: { read: "Bases, tablas y registros.", write: "Crear y cambiar registros." }, redLines: ["Borrar registros"], sources: ["https://support.airtable.com/docs/using-the-airtable-mcp-server"] }),
  remote("miro", { vendor: "Miro", name: "Miro", logo: "miro", category: "documents", auth: "oauth", endpoint: "https://mcp.miro.com/", description: "Tableros y notas adhesivas.", can: { read: "Tableros y su contenido.", write: "Crear elementos y diagramas." }, sources: ["https://developers.miro.com/docs/miro-mcp"] }),
  remote("dropbox", { vendor: "Dropbox", name: "Dropbox", logo: "dropbox", category: "documents", auth: "oauth", endpoint: "https://mcp.dropbox.com/mcp", status: "beta", listed: false, description: "Busca y lee tus archivos.", can: { read: "Archivos.", write: "Archivos." }, sources: ["https://help.dropbox.com/integrations/dropbox-mcp-server"] }),
  remote("canva", { vendor: "Canva", name: "Canva", logo: null, logoSite: "www.canva.com", category: "documents", auth: "oauth", endpoint: "https://mcp.canva.com/mcp", listed: false, description: "Diseños y plantillas.", can: { read: "Diseños.", write: "Diseños." }, sources: ["https://www.canva.dev/docs/connect/canva-mcp-server-setup/"] }),

  // ---------------------------------------------------------------- team and projects
  remote("atlassian", { vendor: "Atlassian", name: "Jira y Confluence", logo: "atlassian", category: "team", auth: "oauth", endpoint: "https://mcp.atlassian.com/v2/mcp", aliases: ["https://mcp.atlassian.com/v1/mcp"], description: "Tickets de Jira y páginas de Confluence.", can: { read: "Buscar incidencias y páginas.", write: "Crear y cambiar incidencias, páginas y comentarios." }, notes: "Quien administra tu Atlassian puede tener que permitir el dominio de Colmena.", sources: ["https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/"] }),
  remote("linear", { vendor: "Linear", name: "Linear", logo: "linear", category: "team", auth: "oauth", endpoint: "https://mcp.linear.app/mcp", description: "Incidencias, proyectos y ciclos.", can: { read: "Incidencias, proyectos y ciclos.", write: "Crear y cambiar incidencias y comentarios." }, sources: ["https://linear.app/docs/mcp"] }),
  remote("monday", { vendor: "monday.com", name: "monday.com", logo: null, logoSite: "monday.com", category: "team", auth: "oauth", endpoint: "https://mcp.monday.com/mcp", description: "Tableros, elementos y actualizaciones.", can: { read: "Tableros y elementos.", write: "Crear y cambiar elementos." }, redLines: ["Borrar elementos"], notes: "Quien administra tu monday.com aprueba la dirección de vuelta de Colmena la primera vez.", sources: ["https://developer.monday.com/apps/docs/mondaycom-mcp-integration"] }),
  remote("clickup", { vendor: "ClickUp", name: "ClickUp", logo: "clickup", category: "team", auth: "oauth", endpoint: "https://mcp.clickup.com/mcp", description: "Tareas, listas y documentos.", can: { read: "Tareas, listas y documentos.", write: "Crear y cambiar tareas." }, sources: ["https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server"] }),
  remote("factorial", { vendor: "Factorial", name: "Factorial", logo: null, logoSite: "factorialhr.com", category: "team", auth: "oauth", endpoint: "https://mcp.factorialhr.com", perPerson: true, description: "Fichajes, ausencias y tareas de tu equipo en Factorial.", can: { read: "Ausencias, fichajes y equipo.", write: "Fichar, pedir ausencias y crear tareas." }, redLines: [], sources: ["https://apidoc.factorialhr.com/docs/mcp-server"] }),
  {
    id: "slack", vendor: "Composio", name: "Slack", logo: null, logoSite: "slack.com", category: "team", auth: "composio", run: "composio", toolkit: "slack", status: "stable", verifiedAt: VERIFIED, perPerson: true, listed: true,
    description: "Tus canales y mensajes de Slack con tu cuenta de Composio.",
    can: { read: "Canales y mensajes.", write: "Mensajes." }, redLines: ["Enviar un mensaje"],
    thirdParty: "Los mensajes pasan por Composio, un tercero.",
    setup: ["Crea tu cuenta gratuita en Composio.", "Pega tu clave de API de Composio.", "Pulsa «Conectar Slack»."],
    sources: ["https://docs.slack.dev/ai/mcp-server/"],
  },
  {
    id: "asana", vendor: "Composio", name: "Asana", logo: "asana", category: "team", auth: "composio", run: "composio", toolkit: "asana", status: "stable", verifiedAt: VERIFIED, perPerson: true, listed: true,
    description: "Tareas y proyectos del equipo con tu cuenta de Composio.", can: { read: "Tareas y proyectos.", write: "Crear y cambiar tareas." }, redLines: ["Borrar tareas"],
    thirdParty: "Los datos pasan por Composio, un tercero.", setup: ["Crea tu cuenta gratuita en Composio.", "Pega tu clave de API de Composio.", "Pulsa «Conectar Asana»."],
    sources: ["https://developers.asana.com/docs/integrating-with-asanas-mcp-server"],
  },

  // ---------------------------------------------------------------- sales and customers
  remote("intercom", { vendor: "Intercom", name: "Intercom", logo: "intercom", category: "sales", auth: "token", endpoint: "https://mcp.intercom.com/mcp", token: { header: "Authorization", scheme: "Bearer", label: "Token de acceso de Intercom", where: "Intercom › Ajustes › Integraciones › Developer Hub › tu app › Autenticación." }, description: "Conversaciones, contactos y artículos de ayuda.", can: { read: "Conversaciones, contactos y artículos.", write: "Notas internas y artículos." }, redLines: ["Publicar un artículo"], sources: ["https://developers.intercom.com/docs/guides/mcp"] }),
  remote("close", { vendor: "Close", name: "Close", logo: null, logoSite: "www.close.com", category: "sales", auth: "oauth", endpoint: "https://mcp.close.com/mcp", description: "Contactos y oportunidades de venta.", can: { read: "Leads, contactos y oportunidades.", write: "Crear y cambiar leads y tareas." }, redLines: ["Borrar (solo con el permiso «destructivo»)"], sources: ["https://developer.close.com/topics/mcp/"] }),
  remote("calendly", { vendor: "Calendly", name: "Calendly", logo: "calendly", category: "sales", auth: "oauth", endpoint: "https://mcp.calendly.com", perPerson: true, description: "Tus tipos de evento, reservas y disponibilidad.", can: { read: "Eventos, reservas y disponibilidad.", write: "Reservar y cancelar citas." }, redLines: ["Reservar o cancelar una cita"], sources: ["https://developer.calendly.com/calendly-mcp-server"] }),
  remote("holded", { vendor: "Holded", name: "Holded", logo: null, logoSite: "www.holded.com", category: "sales", auth: "oauth", endpoint: "https://mcp.holded.com/mcp", description: "Contactos, CRM, presupuestos y pedidos de Holded. Facturas y pagos, solo lectura.", can: { read: "Contactos, CRM, presupuestos, facturas y pagos.", write: "Contactos, presupuestos, proformas y pedidos." }, notes: "En Holded tiene que estar activado el acceso por API.", sources: ["https://help.holded.com/en/articles/15646468-connect-holded-with-ia"] }),
  {
    id: "hubspot", vendor: "Composio", name: "HubSpot", logo: "hubspot", category: "sales", auth: "composio", run: "composio", toolkit: "hubspot", status: "stable", verifiedAt: VERIFIED, perPerson: true, listed: true,
    description: "Contactos, empresas y negocios con tu cuenta de Composio.", can: { read: "Contactos, empresas y negocios.", write: "Crear y cambiar registros del CRM." }, redLines: ["Publicar páginas o entradas", "Borrar registros"],
    thirdParty: "Los datos pasan por Composio, un tercero.", setup: ["Crea tu cuenta gratuita en Composio.", "Pega tu clave de API de Composio.", "Pulsa «Conectar HubSpot»."],
    sources: ["https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server"],
  },

  // ---------------------------------------------------------------- marketing and analytics
  {
    id: "google-analytics", vendor: "Google", name: "Google Analytics", logo: "googleanalytics", category: "marketing", auth: "google", run: "local", transport: "stdio", status: "stable", verifiedAt: VERIFIED, perPerson: true, listed: true,
    description: "Informes de tus propiedades de Analytics 4, en tiempo real y de embudo. Solo lectura.",
    can: { read: "Cuentas, propiedades e informes (también en tiempo real y embudos).", write: "Nada: Colmena lo ejecuta en modo solo lectura." },
    redLines: [],
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    local: { package: "analytics-mcp", version: "1.1.0", command: "analytics-mcp", env: { project: "GOOGLE_CLOUD_PROJECT" } },
    guide: "docs/GOOGLE-ANALYTICS-ADS.md",
    sources: ["https://github.com/googleanalytics/google-analytics-mcp", "https://developers.google.com/analytics/devguides/config/admin/v1/quickstart"],
  },
  {
    id: "google-ads", vendor: "Google", name: "Google Ads", logo: "googleads", category: "marketing", auth: "google", run: "local", transport: "stdio", status: "stable", verifiedAt: VERIFIED, perPerson: true, listed: true,
    description: "Campañas, métricas y cuentas de Google Ads con consultas GAQL.",
    can: { read: "Cuentas accesibles, campañas, métricas e informes.", write: "Recursos y etiquetas (Colmena lo deja en solo lectura)." },
    redLines: [],
    scopes: ["https://www.googleapis.com/auth/adwords"],
    blocked: "Google clasifica el permiso de Google Ads como restringido: exige una evaluación de seguridad anual (CASA) que Colmena no hace. Mientras, usa Google Ads con Composio en «Otras apps».",
    local: { package: "google-ads-mcp", version: "0.0.6", command: "google-ads-mcp", env: { project: "GOOGLE_PROJECT_ID", loginCustomer: "GOOGLE_ADS_LOGIN_CUSTOMER_ID" } },
    guide: "docs/GOOGLE-ANALYTICS-ADS.md",
    sources: ["https://github.com/googleads/google-ads-mcp", "https://developers.google.com/google-ads/api/docs/api-policy/access-levels", "https://developers.google.com/google-ads/api/docs/productionize/secure-credentials"],
  },
  remote("posthog", { vendor: "PostHog", name: "PostHog", logo: "posthog", category: "marketing", auth: "token", endpoint: "https://mcp.posthog.com/mcp", token: { header: "Authorization", scheme: "Bearer", label: "Clave personal de API de PostHog", where: "PostHog › Ajustes de la cuenta › Claves personales de API (preset «MCP Server»)." }, description: "Analítica de producto, feature flags y experimentos.", can: { read: "Eventos, insights, flags y errores.", write: "Crear y cambiar flags, insights y experimentos." }, redLines: ["Borrar flags o insights"], sources: ["https://posthog.com/docs/model-context-protocol"] }),
  remote("brevo", { vendor: "Brevo", name: "Brevo", logo: "brevo", category: "marketing", auth: "token", endpoint: "https://mcp.brevo.com/v1/brevo/mcp", token: { header: "Authorization", scheme: "Bearer", label: "Token MCP de Brevo", where: "Brevo › Ajustes › SMTP y API › Claves de API y MCP." }, description: "Contactos, listas y campañas de email, SMS y WhatsApp.", can: { read: "Contactos, listas, campañas y estadísticas.", write: "Contactos, listas y campañas." }, redLines: ["Enviar una campaña de email, SMS o WhatsApp"], sources: ["https://developers.brevo.com/docs/mcp-protocol"] }),
  remote("google-maps", { vendor: "Google", name: "Google Maps (Grounding Lite)", logo: "googlemaps", category: "marketing", auth: "token", endpoint: "https://mapstools.googleapis.com/mcp", token: { header: "X-Goog-Api-Key", scheme: "", label: "Clave de API de Google Maps Platform", where: "Google Cloud › APIs y servicios › Credenciales, con «Maps Grounding Lite API» activada (de pago tras el nivel gratuito)." }, description: "Lugares, rutas y el tiempo con los datos de Google Maps. Solo lectura.", can: { read: "Buscar lugares, calcular rutas y consultar el tiempo.", write: "Nada." }, sources: ["https://developers.google.com/maps/ai/grounding-lite", "https://docs.cloud.google.com/mcp/supported-products"] }),

  // ---------------------------------------------------------------- payments and invoices
  remote("stripe", { vendor: "Stripe", name: "Stripe", logo: "stripe", category: "finance", auth: "oauth", endpoint: "https://mcp.stripe.com", description: "Clientes, pagos, facturas y suscripciones.", can: { read: "Clientes, pagos, facturas y saldos.", write: "Clientes, facturas, enlaces de pago y reembolsos." }, redLines: ["Reembolsos, cobros y envíos de dinero", "Cancelar suscripciones"], sources: ["https://docs.stripe.com/mcp"] }),
  remote("square", { vendor: "Square", name: "Square", logo: "square", category: "finance", auth: "oauth", endpoint: "https://mcp.squareup.com/mcp", status: "beta", description: "Ventas, pedidos y catálogo.", can: { read: "Pagos, pedidos, clientes y catálogo.", write: "Pedidos, clientes y catálogo." }, redLines: ["Cobros y reembolsos"], sources: ["https://developer.squareup.com/docs/mcp"] }),
  remote("paypal", { vendor: "PayPal", name: "PayPal", logo: "paypal", category: "finance", auth: "oauth", endpoint: "https://mcp.paypal.com/mcp", listed: false, description: "Pagos, facturas y transacciones.", can: { read: "Transacciones.", write: "Facturas." }, sources: ["https://docs.paypal.ai/developer/tools/ai/mcp-quickstart"] }),
  remote("wix", { vendor: "Wix", name: "Wix", logo: "wix", category: "finance", auth: "oauth", endpoint: "https://mcp.wix.com/mcp", description: "Tu web, tienda y reservas.", can: { read: "Sitio, tienda, pedidos y reservas.", write: "Contenido, productos y reservas." }, redLines: ["Publicar el sitio"], sources: ["https://dev.wix.com/docs/sdk/articles/use-the-wix-mcp/about-the-wix-mcp"] }),

  // ---------------------------------------------------------------- development and data
  remote("github", { vendor: "GitHub", name: "GitHub", logo: "github", category: "development", auth: "token", endpoint: "https://api.githubcopilot.com/mcp/", perPerson: true, token: { header: "Authorization", scheme: "Bearer", label: "Token personal de GitHub", where: "GitHub › Settings › Developer settings › Personal access tokens (fine-grained)." }, description: "Repositorios, issues y pull requests (el servidor MCP oficial de GitHub).", can: { read: "Código, issues, pull requests y Actions.", write: "Issues, comentarios, ramas y pull requests." }, redLines: ["Fusionar un pull request", "Borrar ramas o archivos"], sources: ["https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server", "https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md"] }),
  remote("sentry", { vendor: "Sentry", name: "Sentry", logo: "sentry", category: "development", auth: "oauth", endpoint: "https://mcp.sentry.dev/mcp", description: "Errores y rendimiento de tus apps.", can: { read: "Incidencias, eventos y trazas.", write: "Asignar y resolver incidencias." }, sources: ["https://docs.sentry.io/product/sentry-mcp/"] }),
  remote("supabase", { vendor: "Supabase", name: "Supabase", logo: "supabase", category: "development", auth: "oauth", endpoint: "https://mcp.supabase.com/mcp", description: "Bases de datos y proyectos.", can: { read: "Tablas, registros, logs y documentación.", write: "SQL, migraciones y funciones." }, redLines: ["Migraciones y SQL que cambian datos", "Borrar ramas o pausar proyectos", "Desplegar funciones"], sources: ["https://supabase.com/docs/guides/getting-started/mcp"] }),
  remote("cloudflare", { vendor: "Cloudflare", name: "Cloudflare", logo: "cloudflare", category: "development", auth: "oauth", endpoint: "https://mcp.cloudflare.com/mcp", description: "Dominios, DNS y Workers.", can: { read: "Cuentas, zonas, Workers y registros.", write: "Toda la API de Cloudflare." }, redLines: ["Desplegar o borrar", "Cambiar DNS"], sources: ["https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/"] }),
  remote("vercel", { vendor: "Vercel", name: "Vercel", logo: "vercel", category: "development", auth: "oauth", endpoint: "https://mcp.vercel.com", listed: false, description: "Proyectos y despliegues.", can: { read: "Proyectos.", write: "Despliegues." }, sources: ["https://vercel.com/docs/mcp/vercel-mcp"] }),
  remote("figma", { vendor: "Figma", name: "Figma", logo: "figma", category: "development", auth: "oauth", endpoint: "https://mcp.figma.com/mcp", listed: false, description: "Archivos de diseño y componentes.", can: { read: "Diseños.", write: "—" }, sources: ["https://developers.figma.com/docs/figma-mcp-server/"] }),
  remote("webflow", { vendor: "Webflow", name: "Webflow", logo: "webflow", category: "development", auth: "oauth", endpoint: "https://mcp.webflow.com/mcp", listed: false, description: "Sitios y colecciones del CMS.", can: { read: "Sitios.", write: "CMS." }, sources: ["https://developers.webflow.com/mcp/reference/overview"] }),
  remote("bigquery", { vendor: "Google", name: "BigQuery", logo: "googlebigquery", category: "development", auth: "google", perPerson: true, endpoint: "https://bigquery.googleapis.com/mcp", description: "Consultas SQL sobre tus conjuntos de datos de BigQuery.", can: { read: "Conjuntos de datos, tablas y consultas de solo lectura.", write: "SQL que cambia datos." }, scopes: ["https://www.googleapis.com/auth/bigquery"], redLines: ["execute_sql: SQL que cambia o borra datos"], sources: ["https://docs.cloud.google.com/bigquery/docs/use-bigquery-mcp", "https://docs.cloud.google.com/mcp/supported-products"] }),
  remote("zapier", { vendor: "Zapier", name: "Zapier", logo: "zapier", category: "other", auth: "oauth", endpoint: "https://mcp.zapier.com/api/v1/connect", aliases: ["https://mcp.zapier.com/api/mcp/mcp"], description: "Las acciones que configures en tu Zapier, en miles de apps.", can: { read: "Lo que permitan tus acciones de Zapier.", write: "Lo que permitan tus acciones de Zapier." }, redLines: ["Envíos, pagos y borrados en las apps de tus acciones"], notes: "Cada acción consume tareas de tu plan de Zapier.", sources: ["https://docs.zapier.com/mcp/get-started/connect/claude-code"] }),

  // ---------------------------------------------------------------- the long tail
  {
    id: "composio", vendor: "Composio", name: "Otras apps (Composio)", logo: null, category: "other", auth: "composio", run: "composio", toolkit: null, status: "stable", verifiedAt: VERIFIED, perPerson: false, listed: true,
    description: "Cientos de apps más a través de Composio, con tu cuenta de Composio o la de tu empresa.",
    can: { read: "Depende de cada app.", write: "Depende de cada app." }, redLines: ["Enviar, publicar, pagar o borrar en cualquier app"],
    thirdParty: "Los datos de esas apps pasan por Composio, un tercero.",
    setup: ["Crea tu cuenta gratuita en Composio.", "Pega tu clave de API de Composio.", "Busca la app y pulsa «Conectar»."],
    sources: ["https://composio.dev/pricing", "https://docs.composio.dev/docs/authenticating-tools"],
  },
];

// The older fields (url, via) the desktop screens and tests still read.
for (const e of CATALOG) Object.assign(e, { via: e.auth === "composio" ? "composio" : "mcp", ...(e.endpoint ? { url: e.endpoint } : {}) });

// Brands without a simple-icons logo: Colmena shows their site's icon (GET /api/mcp/logo/:id).
export const LOGO_SITES = Object.fromEntries(CATALOG.filter((e) => e.logoSite).map((e) => [e.id, e.logoSite]));

export const catalogEntry = (id) => CATALOG.find((e) => e.id === id) || null;
/** The entry an existing server record came from, also by an older address of that vendor. */
export const entryForUrl = (url) => CATALOG.find((e) => e.endpoint === url || (e.aliases || []).includes(url)) || null;
/** «mcp» (Colmena talks MCP itself) or «composio»: what the older screens still read. */
export const viaOf = (e) => (e.auth === "composio" ? "composio" : "mcp");

/**
 * The public shape of one entry for the marketplace. `google`: whether Colmena's own Google client
 * is configured here (without it, Google entries read «Disponible pronto»).
 */
export function entryView(e, { google = false } = {}) {
  const soon = !!e.blocked || (e.auth === "google" && !google);
  return {
    id: e.id, vendor: e.vendor, name: e.name, category: e.category, description: e.description,
    logo: e.logoSite ? "/api/mcp/logo/" + e.id : null, icon: e.logo || null,
    auth: e.auth, run: e.run, transport: e.transport || null, status: e.status, availability: soon ? "soon" : "ready",
    via: viaOf(e), toolkit: e.toolkit || null, endpoint: e.endpoint || null, perPerson: !!e.perPerson,
    can: e.can || {}, redLines: e.redLines || [], setup: e.setup || [], scopes: e.scopes || [], notes: e.notes || null,
    token: e.token ? { label: e.token.label, where: e.token.where } : null, thirdParty: e.thirdParty || null,
    blocked: e.blocked || null, guide: e.guide || null, verifiedAt: e.verifiedAt, sources: e.sources || [],
  };
}
