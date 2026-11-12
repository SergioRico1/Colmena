import { useCallback, useState, useSyncExternalStore } from "react";
import { post } from "./api.js";
import { batchOutcome, failureText } from "./approvalGroups.js";

// «Aprobar todas» of a group card (lib/approvalGroups.js): one call, each request decided on
// the server exactly as alone (POST /api/approvals/batch). What failed stays remembered here,
// outside any screen, so the card that remains says which ones are still pending and why.

const failed = new Map(); // approval id → why it could not be decided
const subs = new Set();
let version = 0;
const notify = () => { version++; for (const fn of subs) fn(); };
const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const getVersion = () => version;

/** Map(id → reason) of the requests a batch could not decide; re-renders when it changes. */
export function useBatchFailures() {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return failed;
}

/** Decides every item at once. Returns how many remain; throws when nothing could be sent. */
export async function decideBatch(items, decision, reason = "") {
  const { results = [] } = await post("/approvals/batch", { decision, items: items.map((a) => ({ id: a.id, revision: a.revision })), ...(reason ? { reason } : {}) });
  const outcome = batchOutcome(results);
  for (const id of outcome.done) failed.delete(id);
  for (const [id, why] of outcome.failed) failed.set(id, why);
  if (failed.size > 200) failed.delete(failed.keys().next().value);
  notify();
  return outcome.failed.size;
}

/** {busy, error, run(decision, reason)} for one group card. `wrap`: store.run, to refresh after. */
export function useApprovalBatch(items, wrap = (fn) => fn()) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (decision, reason = "") => {
    setBusy(true);
    setError(null);
    try {
      const left = await wrap(() => decideBatch(items, decision, reason));
      if (left) setError(failureText(left, decision));
      return left;
    } catch (e) {
      setError(e?.message || "No se pudo completar. Vuelve a intentarlo.");
      return items.length;
    } finally {
      setBusy(false);
    }
  }, [items, wrap]);
  return { busy, error, setError, run };
}
