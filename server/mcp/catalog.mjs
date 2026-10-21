// Connections catalogue: MCP first, Composio when there is no way around it.
// Every «mcp» entry is the service's own remote MCP server with OAuth and dynamic client
// registration (checked on 2026-10-16): Colmena registers itself and the person signs in with
// one click, with no developer setup and no intermediary to pay. Services without that
// (Google, Microsoft, Slack, GitHub, HubSpot, Asana, Box) go through Composio.

export const CATEGORIES = { mail: "Correo y calendario", documents: "Documentos", team: "Equipo", development: "Desarrollo", business: "Negocio" };

const mcp = (id, name, url, category, description) => ({ id, name, url, category, description, via: "mcp" });
const composio = (id, name, toolkit, category, description) => ({ id, name, toolkit, category, description, via: "composio" });

export const CATALOG = [
  // Through Composio (no public MCP server that registers clients on its own).
  composio("gmail", "Gmail", "gmail", "mail", "Busca correos y prepara respuestas."),
  composio("googlecalendar", "Google Calendar", "googlecalendar", "mail", "Consulta eventos y disponibilidad."),
  composio("googlesheets", "Google Sheets", "googlesheets", "documents", "Trabaja con tus hojas de cálculo."),
  composio("googledrive", "Google Drive", "googledrive", "documents", "Busca y lee tus archivos."),
  composio("outlook", "Outlook", "outlook", "mail", "Correo y calendario de Microsoft."),
  composio("slack", "Slack", "slack", "team", "Consulta tus canales y mensajes."),
  composio("github", "GitHub", "github", "development", "Revisa issues y pull requests."),
  composio("hubspot", "HubSpot", "hubspot", "business", "Contactos, empresas y negocios."),
  composio("asana", "Asana", "asana", "team", "Tareas y proyectos del equipo."),
  // Native MCP, one click.
  mcp("notion", "Notion", "https://mcp.notion.com/mcp", "documents", "Consulta y escribe en tus páginas y bases de datos."),
  mcp("linear", "Linear", "https://mcp.linear.app/mcp", "development", "Incidencias, proyectos y ciclos."),
  mcp("atlassian", "Jira y Confluence", "https://mcp.atlassian.com/v1/mcp", "team", "Tickets de Jira y páginas de Confluence."),
  mcp("monday", "monday.com", "https://mcp.monday.com/mcp", "team", "Tableros, elementos y actualizaciones."),
  mcp("clickup", "ClickUp", "https://mcp.clickup.com/mcp", "team", "Tareas, listas y documentos."),
  mcp("miro", "Miro", "https://mcp.miro.com/", "team", "Tableros y notas adhesivas."),
  mcp("airtable", "Airtable", "https://mcp.airtable.com/mcp", "documents", "Bases, tablas y registros."),
  mcp("dropbox", "Dropbox", "https://mcp.dropbox.com/mcp", "documents", "Busca y lee tus archivos."),
  mcp("canva", "Canva", "https://mcp.canva.com/mcp", "documents", "Diseños y plantillas."),
  mcp("figma", "Figma", "https://mcp.figma.com/mcp", "development", "Archivos de diseño y componentes."),
  mcp("stripe", "Stripe", "https://mcp.stripe.com", "business", "Clientes, pagos y facturas."),
  mcp("paypal", "PayPal", "https://mcp.paypal.com/mcp", "business", "Pagos, facturas y transacciones."),
  mcp("square", "Square", "https://mcp.squareup.com/mcp", "business", "Ventas, pedidos y catálogo."),
  mcp("intercom", "Intercom", "https://mcp.intercom.com/mcp", "business", "Conversaciones con clientes."),
  mcp("close", "Close", "https://mcp.close.com/mcp", "business", "Contactos y oportunidades de venta."),
  mcp("wix", "Wix", "https://mcp.wix.com/mcp", "business", "Tu web, tienda y reservas."),
  mcp("webflow", "Webflow", "https://mcp.webflow.com/mcp", "development", "Sitios y colecciones del CMS."),
  mcp("zapier", "Zapier", "https://mcp.zapier.com/api/mcp/mcp", "business", "Las acciones que configures en tu Zapier."),
  mcp("sentry", "Sentry", "https://mcp.sentry.dev/mcp", "development", "Errores y rendimiento de tus apps."),
  mcp("vercel", "Vercel", "https://mcp.vercel.com", "development", "Proyectos y despliegues."),
  mcp("supabase", "Supabase", "https://mcp.supabase.com/mcp", "development", "Bases de datos y proyectos."),
  mcp("cloudflare", "Cloudflare", "https://mcp.cloudflare.com/mcp", "development", "Dominios, DNS y Workers."),
];

// Logos come from simple-icons (CC0) in the app; these brands are not there, so Colmena shows
// the icon of their own website (GET /api/mcp/logo/:id, cached).
export const LOGO_SITES = { outlook: "outlook.live.com", slack: "slack.com", canva: "www.canva.com", monday: "monday.com", close: "www.close.com" };

export const catalogEntry = (id) => CATALOG.find((e) => e.id === id) || null;
