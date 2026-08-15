/**
 * pipeline/expire.ts — move products past their end date (product-level or their
 * app's end date) into the Trash (soft-delete). Runs at the start of check-all.
 */
import type { Deps } from "../deps.js";

export async function expireProducts(deps: Deps): Promise<{ expired: string[] }> {
  const now = deps.now().getTime();
  const [products, collections] = await Promise.all([
    deps.db.getTrackedProducts(),
    deps.db.getCollections(),
  ]);
  const colEnd = new Map(
    collections.map((c) => [c.id, c.expiresAt ? Date.parse(c.expiresAt) : Infinity]),
  );
  const expired: string[] = [];
  for (const p of products) {
    const pEnd = p.expiresAt ? Date.parse(p.expiresAt) : Infinity;
    const cEnd = p.collectionId ? (colEnd.get(p.collectionId) ?? Infinity) : Infinity;
    const end = Math.min(pEnd, cEnd);
    if (Number.isFinite(end) && end <= now) {
      await deps.db.updateTrackedProduct(p.id, { deletedAt: deps.now().toISOString() });
      expired.push(p.id);
    }
  }
  return { expired };
}
