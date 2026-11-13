// The red lines, in one place for every screen that explains them (Autonomía y permisos, the
// step after connecting an app, the log): what always waits for your OK, whatever a bot's
// autonomy, a routine or a «Permitir siempre» says (server/connections.mjs, server/grants.mjs).
// Browsing and reading never ask.

export const RED_LINES = [
  ["Enviar algo fuera", "Correos, mensajes o invitaciones a cualquiera fuera de Colmena."],
  ["Pagar, comprar o reservar", "Pagos, compras, suscripciones, reservas y transferencias."],
  ["Publicar", "Una publicación, un comentario o un cambio que vea el público."],
  ["Borrar de verdad", "Archivos, correos o registros, aunque se puedan recuperar."],
  ["Escribir contraseñas", "Las pone Colmena desde tu bóveda o te las pide a ti."],
  ["Instalar programas", "Programas, extensiones o cambios en este ordenador."],
];

/** The one sentence that says what a red line is, wherever it is explained. */
export const RED_LINE_RULE = "Ningún ajuste, rutina, bot ni «Permitir siempre» puede saltárselas. Leer y navegar nunca te pregunta.";
