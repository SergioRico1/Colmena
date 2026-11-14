// Fixture pages for the cloud browser's e2e (docs/CLOUD.md › Phase 4), served only when the Worker
// has the test secret FAKE_MODEL_TOKEN: a page to read and a form to fill and send. Nothing is
// stored; the form's answer only echoes the field names it got. No third-party site is involved.
const page = (title, body) => new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1d1b16;background:#fffdf7}label{display:block;margin:12px 0 4px}input,select,textarea{font:inherit;padding:8px;width:100%;box-sizing:border-box}button{margin-top:16px;padding:10px 18px;font:inherit}</style></head><body>${body}</body></html>`, {
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" },
});
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function testPage(request, url) {
  if (url.pathname === "/prueba/pagina" && request.method === "GET")
    return page("Página de prueba de Colmena", "<h1>Página de prueba de Colmena</h1><p>El código secreto de esta página es <strong>COLMENA-4242</strong>.</p><p>Sirve para comprobar que el navegador de los bots en la nube lee páginas públicas.</p><a href=\"/prueba/formulario\">Ir al formulario</a>");
  if (url.pathname === "/prueba/formulario" && request.method === "GET")
    return page("Formulario de prueba", `<h1>Formulario de prueba</h1><form method="post" action="/prueba/formulario">
<label for="nombre">Nombre</label><input id="nombre" name="nombre" autocomplete="off">
<label for="correo">Correo</label><input id="correo" name="correo" type="email" autocomplete="off">
<label for="tema">Tema</label><select id="tema" name="tema"><option>Ventas</option><option>Soporte</option></select>
<label for="mensaje">Mensaje</label><textarea id="mensaje" name="mensaje"></textarea>
<button type="submit">Enviar</button></form>`);
  if (url.pathname === "/prueba/formulario" && request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const got = form ? [...form.keys()].filter((k) => String(form.get(k) || "").trim()).map(escape) : [];
    return page("Recibido", "<h1>Recibido</h1><p>Campos rellenos: " + (got.join(", ") || "ninguno") + ".</p>");
  }
  return new Response("No encontrado.", { status: 404 });
}
