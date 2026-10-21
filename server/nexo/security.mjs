import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export const ISSUER = "https://auth.openai.com";
export const RESOURCE = "https://api.openai.com/v1";
export const DISCOVERY = ISSUER + "/.well-known/openid-configuration";
export const TOKEN_ENDPOINT = ISSUER + "/api/accounts/oauth/token";
export const AUTHORIZE_ENDPOINT = ISSUER + "/api/accounts/authorize";
export const PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const SCOPES =
  "openid profile email offline_access resource.invoke " + PLAN_SCOPE;
export function opaque(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
export function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function pkce() {
  const verifier = opaque(48);
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}
export function normalizeHostID(value) {
  // NEXO creates UUIDv4 hosts. Preserve legacy UUIDs while adding the URI prefix
  // required by OpenAI; never replace a malformed identity with another host.
  if (typeof value !== "string")
    throw Error("Identificador de instalación no válido.");
  const match =
    /^(?:urn:uuid:)?([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.exec(
      value,
    );
  if (!match) throw Error("Identificador de instalación no válido.");
  return "urn:uuid:" + match[1].toLowerCase();
}
export function authorizeURL({
  hostId,
  clientId,
  redirectURI,
  state,
  nonce,
  challenge,
  idTokenHint,
  loginHint,
}) {
  const u = new URL(AUTHORIZE_ENDPOINT);
  const params = {
    client_id: clientId || "dynamic_agent_client",
    ext_agent_host_id: normalizeHostID(hostId),
    response_type: "code",
    redirect_uri: redirectURI,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  };
  if (!clientId) params.agent_name_hint = "Colmena";
  else {
    if (typeof idTokenHint === "string" && idTokenHint.length <= 32768)
      params.id_token_hint = idTokenHint;
    if (typeof loginHint === "string" && loginHint.length <= 320)
      params.login_hint = loginHint;
  }
  u.search = new URLSearchParams(params).toString();
  return u.href;
}
export function trustedAuthEndpoint(raw) {
  const u = new URL(raw);
  if (u.origin !== ISSUER || u.username || u.password || u.hash)
    throw Error("Endpoint de identidad no permitido.");
  return u.href;
}
/** Small dependency-free verifier: RS256/ES256 only. Fail closed on unfamiliar algorithms.
 * Replace with an independently audited JOSE library before public distribution. */
export function verifyIDToken(
  token,
  jwks,
  { clientId, nonce, subject, now = Math.floor(Date.now() / 1000) },
) {
  if (typeof token !== "string" || token.length > 32768)
    throw Error("ID token inválido.");
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    parts.some((p) => !p || !/^[A-Za-z0-9_-]+$/.test(p))
  )
    throw Error("Formato JWT inválido.");
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url"));
  } catch {
    throw Error("Contenido JWT inválido.");
  }
  if (
    !["RS256", "ES256"].includes(header.alg) ||
    typeof header.kid !== "string" ||
    header.crit ||
    header.jku ||
    header.x5u
  )
    throw Error("Cabecera JWT no admitida.");
  const candidates = (jwks?.keys || []).filter(
    (k) =>
      k.kid === header.kid &&
      (!k.use || k.use === "sig") &&
      (!k.alg || k.alg === header.alg),
  );
  if (candidates.length !== 1)
    throw Error("Clave de firma desconocida o ambigua.");
  const jwk = candidates[0];
  if (
    header.alg === "RS256" &&
    (jwk.kty !== "RSA" || Buffer.from(jwk.n || "", "base64url").length < 256)
  )
    throw Error("Clave RSA no válida.");
  if (header.alg === "ES256" && (jwk.kty !== "EC" || jwk.crv !== "P-256"))
    throw Error("Clave EC no válida.");
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const valid = verifySignature(
    "sha256",
    Buffer.from(parts[0] + "." + parts[1]),
    header.alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key,
    Buffer.from(parts[2], "base64url"),
  );
  if (!valid) throw Error("La firma del ID token no es válida.");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== ISSUER ||
    !aud.includes(clientId) ||
    (aud.length > 1 && claims.azp !== clientId) ||
    (claims.azp && claims.azp !== clientId)
  )
    throw Error("Identidad emitida para otro cliente.");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 512)
    throw Error("Identidad incompleta.");
  if (
    !Number.isFinite(claims.exp) ||
    claims.exp <= now - 5 ||
    !Number.isFinite(claims.iat) ||
    claims.iat > now + 5 ||
    (claims.nbf !== undefined &&
      (!Number.isFinite(claims.nbf) || claims.nbf > now + 5))
  )
    throw Error("El ID token ha caducado o aún no es válido.");
  if (nonce !== undefined && !equal(claims.nonce, nonce))
    throw Error(
      "La respuesta de identidad no corresponde a esta autorización.",
    );
  if (subject !== undefined && !equal(claims.sub, subject))
    throw Error("La cuenta no coincide con el registro seleccionado.");
  return claims;
}
export function normalizeModels(data) {
  if (!Array.isArray(data?.models))
    throw Error("Formato de catálogo de modelos no reconocido.");
  return data.models
    .filter(
      (m) =>
        m &&
        m.visibility === "list" &&
        typeof m.slug === "string" &&
        m.slug.length <= 200,
    )
    .slice(0, 100)
    .map((m) => ({
      slug: m.slug,
      display_name:
        typeof m.display_name === "string"
          ? m.display_name.slice(0, 150)
          : m.slug,
      reasoning_efforts: modelEfforts(m),
    }));
}
export function modelEfforts(model) {
  const allowed = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ];
  const declared = model.supported_reasoning_levels || model.reasoning_efforts;
  if (Array.isArray(declared))
    return [
      ...new Set(
        declared
          .map((x) => (typeof x === "string" ? x : x?.effort))
          .filter((x) => allowed.includes(x)),
      ),
    ];
  // Conservative documented common levels; future/unknown models stay on Auto.
  return /^gpt-(?:6(?:\.1)?-(?:sol|astra|luna)|5\.(?:5|6)(?:-(?:sol|terra|luna))?)$/.test(
    model.slug,
  )
    ? ["low", "medium", "high"]
    : [];
}
function limitedString(value, max, label) {
  if (typeof value !== "string" || value.length > max)
    throw Error(label + " no válido.");
  return value;
}
export function validateInference(payload, models) {
  if (!payload || !models.some((m) => m.slug === payload.model))
    throw Error("Selecciona un modelo disponible para esta cuenta.");
  const prompt = limitedString(payload.prompt, 12000, "Mensaje").trim();
  if (!prompt) throw Error("Escribe un mensaje.");
  const raw = payload.context || {},
    sources = raw.sources || [],
    observations = raw.observations || [];
  if (
    !Array.isArray(sources) ||
    !Array.isArray(observations) ||
    sources.length + observations.length > 30
  )
    throw Error("Demasiadas fuentes. Selecciona como máximo 30.");
  let size = 0;
  const clean = (items) =>
    items.map((s) => {
      if (!s || typeof s !== "object") throw Error("Fuente no válida.");
      const text = limitedString(s.text || "", 40000, "Texto");
      size += text.length;
      let url = "";
      if (s.url) {
        const u = new URL(s.url);
        if (
          !["http:", "https:"].includes(u.protocol) ||
          u.username ||
          u.password
        )
          throw Error("Fuente con URL no permitida.");
        url = u.href;
      }
      return {
        title: limitedString(s.title || "", 200, "Título"),
        text,
        url,
        example: s.example === true,
        capturedAt:
          typeof s.capturedAt === "string"
            ? s.capturedAt.slice(0, 40)
            : undefined,
        limitations: Array.isArray(s.limitations)
          ? s.limitations.slice(0, 8).map((x) => String(x).slice(0, 400))
          : undefined,
      };
    });
  const context = {
    sources: clean(sources),
    observations: clean(observations),
  };
  if (size > 100000)
    throw Error("El contexto supera 100.000 caracteres. Reduce las fuentes.");
  let image = null;
  if (raw.image != null) {
    image = limitedString(raw.image, 3 * 1024 * 1024, "Imagen");
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image))
      throw Error("La imagen debe ser una captura JPEG válida.");
    const bytes = Buffer.from(image.split(",")[1], "base64");
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
      throw Error("La imagen no es JPEG.");
  }
  return { model: payload.model, prompt, context, image };
}
