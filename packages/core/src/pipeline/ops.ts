/**
 * pipeline/ops.ts — health ping + add-a-URL (canonicalize, insert, first check).
 */
import type { Deps } from "../deps.js";
import { adapterFor, platformOf } from "../scrape/sites/index.js";
import { checkProduct, type CheckSummary } from "./check.js";

export async function health(deps: Deps): Promise<{ ok: boolean }> {
  await deps.db.ping();
  return { ok: true };
}

export interface AddResult {
  productId: string;
  canonicalUrl: string;
  check: CheckSummary;
}

export async function addProduct(
  deps: Deps,
  url: string,
  opts: { targetPrice?: number | null; pincode?: string | null } = {},
): Promise<AddResult> {
  const adapter = adapterFor(url);
  const canonicalUrl = adapter.canonicalize(url);
  const row = await deps.db.insertTrackedProduct({
    url,
    canonicalUrl,
    platform: platformOf(url),
    targetPrice: opts.targetPrice ?? null,
    pincode: opts.pincode ?? deps.cfg.defaultPincode,
  });
  const check = await checkProduct(deps, row.id);
  return { productId: row.id, canonicalUrl, check };
}
