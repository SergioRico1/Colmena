import { z } from "zod";
import { HttpError, check } from "./shared.mjs";
import { BLOCK_LIMITS, blockView, deleteBlock, getBlock, listBlocks, moveBlock, orderBlocks, pinBlock, watchBlocks } from "../blocks.mjs";

// «Bloques vivos» (server/blocks.mjs; docs/CONTRACT.md §17): what the person does with them.
// The bots post and update through block_post; nothing here changes a block's data.
const blockId = z.string().trim().min(1).max(80);

export function registerBlockRoutes(app, { store, scheduler = null }) {
  watchBlocks(store);
  const mustBlock = (id) => {
    const block = getBlock(store, check(blockId, id));
    if (!block) throw new HttpError(404, "Ese bloque ya no existe.");
    return block;
  };
  const panel = () => ({ blocks: listBlocks(store, { pinned: true }) });

  // The panel (`pinned=1`), the blocks of one conversation (`missionId`), or all of them.
  app.get("/api/blocks", (req, res) => {
    const q = check(z.object({ pinned: z.enum(["0", "1"]).default("0"), missionId: z.string().trim().max(80).default("") }).strict(), { ...req.query });
    res.json({ blocks: listBlocks(store, { pinned: q.pinned === "1", missionId: q.missionId || null }), limits: { pinned: BLOCK_LIMITS.pinned } });
  });
  // The order of the panel, whole (drag) …
  app.post("/api/blocks/order", (req, res) => {
    const { ids } = check(z.object({ ids: z.array(blockId).max(BLOCK_LIMITS.pinned * 2) }).strict(), req.body);
    orderBlocks(store, ids);
    res.json(panel());
  });
  app.get("/api/blocks/:id", (req, res) => res.json(blockView(store, mustBlock(req.params.id))));
  app.post("/api/blocks/:id/pin", (req, res) => {
    const { pinned } = check(z.object({ pinned: z.boolean() }).strict(), req.body);
    const block = pinBlock(store, mustBlock(req.params.id).id, pinned);
    res.json({ block: block ? blockView(store, block) : null, ...panel() });
  });
  // … or one place up or down (the keyboard way).
  app.post("/api/blocks/:id/move", (req, res) => {
    const { direction } = check(z.object({ direction: z.enum(["up", "down"]) }).strict(), req.body);
    moveBlock(store, mustBlock(req.params.id).id, direction);
    res.json(panel());
  });
  // «Actualizar»: one more run of the block's routine, now (Scheduler#refreshNow). Only a block
  // that belongs to a routine has it; the run updates the block when its bot posts again.
  app.post("/api/blocks/:id/refresh", (req, res) => {
    check(z.object({}).strict(), req.body);
    const block = mustBlock(req.params.id);
    if (!block.automationId || !store.get("automations", block.automationId)) throw new HttpError(409, "Este dato no tiene una rutina que lo actualice.");
    if (!scheduler?.refreshNow) throw new HttpError(503, "Las rutinas no están disponibles ahora mismo.");
    const mission = scheduler.refreshNow(block.automationId);
    res.status(202).json({ missionId: mission.id, automationId: block.automationId });
  });
  app.delete("/api/blocks/:id", (req, res) => {
    deleteBlock(store, mustBlock(req.params.id).id);
    res.json({ ok: true, ...panel() });
  });
}
