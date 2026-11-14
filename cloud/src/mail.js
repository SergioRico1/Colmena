// Mail of hosted Colmena: sign-in links and invitations. Providers, first that is configured:
// Cloudflare Email Sending (the SEND_EMAIL binding plus MAIL_FROM_ADDRESS on a verified sending
// domain), or a Resend-shaped HTTP API (POST {from, to, subject, html, text} with a Bearer key,
// secret RESEND_API_KEY). Without either, the dev fallback: the link is never in a public
// response. It is written to the Worker's log (`wrangler tail`) and kept for 30 minutes in the
// directory, where only a holder of the ADMIN_BOOTSTRAP_TOKEN secret can read it
// (GET /auth/dev/mail). How the owner turns real mail on: docs/CLOUD.md › Phase 1 › Mail.

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Subject, text and HTML of each mail, in Spanish. */
export function composeMail(kind, { url, workspace = null, inviter = null, items = [], name = null }) {
  if (kind === "digest") {
    // Unread mentions and direct messages (TeamChat#digestDue), after the minutes the company chose.
    const n = items.length;
    const subject = n === 1 ? "Tienes 1 mensaje para ti sin leer en Colmena" : `Tienes ${n} mensajes para ti sin leer en Colmena`;
    const lines = items.slice(0, 20).map((i) => `${i.author} en ${i.channel}: ${i.text}`);
    const more = n > 20 ? n - 20 : 0;
    const text = `Hola${name ? " " + name : ""}, esto te espera${workspace ? " en " + workspace : ""}:\n\n${lines.join("\n")}${more ? "\n…y " + more + " más" : ""}\n\nÁbrelo aquí: ${url}\n\nPuedes dejar de recibir este resumen en tu perfil de Colmena.`;
    const list = items.slice(0, 20).map((i) => `<li style="margin:0 0 10px"><strong>${escape(i.author)}</strong> <span style="color:#5b5e69">en ${escape(i.channel)}</span><br>${escape(i.text)}</li>`).join("");
    return { subject, text, html: page(`<p>Hola${name ? " " + escape(name) : ""}, esto te espera${workspace ? " en <strong>" + escape(workspace) + "</strong>" : ""}:</p><ul style="padding-left:18px">${list}</ul>${more ? "<p>…y " + more + " más.</p>" : ""}`, url, "Abrir Colmena", "Puedes dejar de recibir este resumen en tu perfil de Colmena.") };
  }
  if (kind === "invite") {
    const subject = `${inviter || "Alguien"} te invita a ${workspace || "su empresa"} en Colmena`;
    // One line on what Colmena is: an invited person may never have heard of it.
    const what = "Colmena es el chat de trabajo de un equipo y sus bots: canales y mensajes entre personas, y bots que preparan el trabajo y esperan el OK de alguien antes de enviar, pagar, comprar, publicar o borrar.";
    const text = `${inviter || "Alguien"} te ha invitado a ${workspace || "su empresa"} en Colmena.\n\n${what}\n\nAcepta aquí (caduca en 7 días):\n${url}\n\nSi no esperabas esta invitación, ignora este correo.`;
    return { subject, text, html: page(`<p><strong>${escape(inviter || "Alguien")}</strong> te ha invitado a <strong>${escape(workspace || "su empresa")}</strong> en Colmena.</p><p style="color:#5b5e69">${escape(what)}</p>`, url, "Aceptar la invitación", "Caduca en 7 días. Si no esperabas esta invitación, ignora este correo.") };
  }
  const subject = "Tu enlace para entrar en Colmena";
  const text = `Entra en Colmena con este enlace (sirve una vez y caduca en 15 minutos):\n${url}\n\nSi no lo has pedido tú, ignora este correo.`;
  return { subject, text, html: page("<p>Pulsa el botón para entrar en Colmena.</p>", url, "Entrar en Colmena", "Sirve una vez y caduca en 15 minutos. Si no lo has pedido tú, ignora este correo.") };
}
function page(intro, url, action, foot) {
  return `<!doctype html><html lang="es"><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1a1b21;background:#ffffff;padding:24px">
<p style="font-weight:800;font-size:20px;margin:0 0 16px">Colmena</p>${intro}
<p style="margin:24px 0"><a href="${escape(url)}" style="display:inline-block;background:#1a1b21;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600">${escape(action)}</a></p>
<p style="color:#5b5e69;font-size:13px">${escape(foot)}</p></body></html>`;
}

/**
 * Sends one mail. `keep(mail)`: where the dev fallback keeps it (the directory's outbox).
 * Returns {sent: true} or {sent: false, dev: true}; throws only when a configured provider fails.
 */
export async function sendMail(env, { to, kind, url, workspace = null, inviter = null, items = [], name = null }, { keep = async () => {}, fetchImpl = fetch } = {}) {
  const mail = composeMail(kind, { url, workspace, inviter, items, name });
  // Reserved test domains (RFC 2606/6761) never reach a real provider: test accounts read their
  // links from the dev outbox, and the sending domain keeps a clean reputation.
  if (isTestAddress(to)) return devMail(kind, to, url, keep);
  // Cloudflare Email Sending (a `send_email` binding named SEND_EMAIL, a sending domain on one of
  // the account's zones): preferred when bound.
  if (env.SEND_EMAIL?.send && env.MAIL_FROM_ADDRESS) {
    await env.SEND_EMAIL.send({ from: { email: env.MAIL_FROM_ADDRESS, name: "Colmena" }, to: to, subject: mail.subject, html: mail.html, text: mail.text });
    return { sent: true };
  }
  if (env.RESEND_API_KEY) {
    const response = await fetchImpl(env.MAIL_API_URL || "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM || "Colmena <onboarding@resend.dev>", to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
    });
    if (!response.ok) throw Error("mail provider answered " + response.status);
    return { sent: true };
  }
  return devMail(kind, to, url, keep);
}

/** Dev fallback: the log (wrangler tail) and the directory's outbox; never the response. */
async function devMail(kind, to, url, keep) {
  console.log(`[colmena-nube] correo de desarrollo (${kind}) para ${to}: ${url}`);
  await keep({ email: to, kind, url });
  return { sent: false, dev: true };
}

/** An address on a reserved test domain: example.com/.net/.org or a .test/.example/.invalid/.localhost name. */
export const isTestAddress = (to) => /@(?:[^@\s]+\.)?(?:example\.(?:com|net|org)|[^@\s]+\.(?:test|example|invalid|localhost))$/i.test(String(to || "").trim());

/** A real mail provider is configured (no dev fallback). */
export const hasMail = (env) => !!((env.SEND_EMAIL?.send && env.MAIL_FROM_ADDRESS) || env.RESEND_API_KEY);
