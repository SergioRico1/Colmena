import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { decodeImage, IMAGE_CODE, pngInfo } from "./images.mjs";
import { checkLimit, record as recordUsage } from "./usage.mjs";
import { now } from "./store.mjs";

// Bot portraits (OpenClaw BOOTSTRAP.md §3): ONE image request for a square 2×2 choice sheet —
// four art directions, equal tiles, no borders or lettering. You pick 1–4 (Colmena never picks
// for you); the browser crops that quarter and sends it back; it is kept as the bot's portrait,
// drawn inside its shape. Without images on your plan, the bot keeps its shape and initial.
//
//   POST   /api/bots/:id/portrait/sheet   → {sheet: url}   (one image with your ChatGPT account)
//   GET    /api/bots/:id/portrait/sheet   the last sheet (PNG)
//   PUT    /api/bots/:id/portrait         {image: base64 PNG, square, ≤ 1 MiB} → {portrait: url}
//   GET    /api/bots/:id/portrait         the portrait (PNG)
//   DELETE /api/bots/:id/portrait         back to the shape and initial
export const PORTRAIT = { maxBytes: 1024 * 1024, minSide: 96, maxSide: 1024, timeoutMs: 240000 };

const SHAPES = { hex: "hexágono", circle: "círculo", square: "cuadrado redondeado", diamond: "rombo", arch: "arco", leaf: "hoja" };

/** The one prompt for the 2×2 sheet: the bot as a friendly character, four directions. */
export function sheetPrompt(bot) {
  return [
    `Hoja de elección de avatar 2×2, cuadrada: cuatro retratos distintos del mismo personaje, «${bot.name}», ${bot.role ? "especialista en " + bot.role.toLowerCase() : "miembro de un equipo de trabajo"}.`,
    `Cada casilla con una dirección artística distinta (1: ilustración plana, 2: 3D suave tipo juguete, 3: trazo de tinta con color, 4: recorte de papel), siempre un personaje amable de cara o busto, centrado, sobre fondo liso de color ${bot.color || "#FFC93C"}, con la forma de un ${SHAPES[bot.shape] || "círculo"} como motivo.`,
    "Cuatro casillas iguales que ocupan toda la imagen, sin huecos, sin bordes, sin marcos, sin números, sin letras ni texto de ningún tipo. Nada de marcas ni logotipos reales.",
  ].join(" ");
}

export function registerPortraitRoutes(app, { store, runtime, z, check, mustGet, HttpError }) {
  const folder = (botId) => path.join(store.directory, "portraits", botId.replace(/[^a-z0-9_-]/gi, "_"));
  const send = async (res, file) => {
    let bytes;
    try { bytes = await readFile(file); } catch { throw new HttpError(404, "No hay imagen."); }
    res.set({ "Content-Type": "image/png", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
    res.send(bytes);
  };
  const busy = new Set();

  app.post("/api/bots/:id/portrait/sheet", async (req, res) => {
    const bot = mustGet("bots", req.params.id, "Bot");
    const provider = runtime?.provider;
    if (typeof provider?.generateImage !== "function") throw new HttpError(501, "Para crear retratos, conecta tu cuenta de ChatGPT.");
    if (busy.has(bot.id)) throw new HttpError(409, "Ya se están dibujando sus retratos.");
    checkLimit(store);
    busy.add(bot.id);
    try {
      const result = await provider.generateImage({ model: runtime.settings?.().model, prompt: sheetPrompt(bot), size: "1024x1024", signal: AbortSignal.timeout(PORTRAIT.timeoutMs) });
      const bytes = Buffer.isBuffer(result?.png) ? result.png : decodeImage(result?.base64);
      const { width, height } = pngInfo(bytes);
      if (Math.abs(width - height) > 4) throw Error("La hoja no salió cuadrada; prueba otra vez.");
      if (result?.usage) recordUsage(store, { botId: bot.id, tokens: result.usage });
      await mkdir(folder(bot.id), { recursive: true });
      await writeFile(path.join(folder(bot.id), "sheet.png"), bytes);
      res.json({ sheet: `/api/bots/${encodeURIComponent(bot.id)}/portrait/sheet?v=${Date.now()}`, width, height });
    } catch (error) {
      if (error?.code === IMAGE_CODE) throw new HttpError(501, error.message);
      throw error;
    } finally {
      busy.delete(bot.id);
    }
  });
  app.get("/api/bots/:id/portrait/sheet", async (req, res) => send(res, path.join(folder(mustGet("bots", req.params.id, "Bot").id), "sheet.png")));

  app.put("/api/bots/:id/portrait", async (req, res) => {
    const bot = mustGet("bots", req.params.id, "Bot");
    const { image } = check(z.object({ image: z.string().min(100).max(Math.ceil(PORTRAIT.maxBytes * 1.37)) }).strict(), req.body);
    const bytes = decodeImage(image.replace(/^data:image\/png;base64,/, ""));
    if (bytes.length > PORTRAIT.maxBytes) throw new HttpError(413, "El retrato supera 1 MB.");
    let info;
    try { info = pngInfo(bytes); } catch { throw new HttpError(400, "El retrato debe ser una imagen PNG."); }
    if (info.width !== info.height || info.width < PORTRAIT.minSide || info.width > PORTRAIT.maxSide) throw new HttpError(400, "El retrato debe ser cuadrado, de 96 a 1024 píxeles.");
    await mkdir(folder(bot.id), { recursive: true });
    await writeFile(path.join(folder(bot.id), "portrait.png"), bytes);
    await rm(path.join(folder(bot.id), "sheet.png"), { force: true });
    const portrait = `/api/bots/${encodeURIComponent(bot.id)}/portrait?v=${Date.now()}`;
    store.patch("bots", bot.id, { portrait, updatedAt: now() });
    res.json({ portrait });
  });
  app.get("/api/bots/:id/portrait", async (req, res) => send(res, path.join(folder(mustGet("bots", req.params.id, "Bot").id), "portrait.png")));
  app.delete("/api/bots/:id/portrait", async (req, res) => {
    const bot = mustGet("bots", req.params.id, "Bot");
    await rm(path.join(folder(bot.id), "portrait.png"), { force: true });
    store.patch("bots", bot.id, { portrait: null, updatedAt: now() });
    res.json({ ok: true });
  });
}
