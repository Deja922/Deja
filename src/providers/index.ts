import type { Context, ProviderRequest, ProviderResponse } from "@/types/index.js";

export interface IProvider {
  send(req: ProviderRequest): Promise<ProviderResponse>;
  countTokens(context: Context): Promise<number>;
}

export type { ProviderRequest, ProviderResponse };
