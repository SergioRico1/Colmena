let token;
export async function api(path, method = "GET", body) {
  if (method !== "GET" && !token) {
    const response = await fetch("/api/bootstrap");
    token = (await response.json()).csrf;
  }
  const response = await fetch("/api" + path, {
    method,
    headers:
      method === "GET"
        ? {}
        : { "Content-Type": "application/json", "X-Colmena-Token": token },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(data.error || "No se pudo completar la operacion.");
  return data;
}
