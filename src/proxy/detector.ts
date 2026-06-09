import type { IncomingMessage } from "http";
import type { IAdapter } from "./adapters/index.js";

/**
 * Auto-detect which adapter handles this request.
 * Returns the first adapter whose pathPattern matches the request URL.
 */
export function detectAdapter(req: IncomingMessage, adapters: IAdapter[]): IAdapter | null {
  const url = req.url ?? "";
  for (const adapter of adapters) {
    if (adapter.pathPattern.test(url)) return adapter;
  }
  return null;
}
