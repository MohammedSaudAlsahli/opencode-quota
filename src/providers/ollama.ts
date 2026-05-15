import type { QuotaProvider, QuotaProviderContext, QuotaProviderResult } from "../lib/entries.js";
import { queryOllamaQuota } from "../lib/ollama.js";
import { isCanonicalProviderAvailable } from "../lib/provider-availability.js";
import { hasOllamaApiKeyConfigured } from "../lib/ollama-auth.js";
import {
  attemptedResult,
  groupedPercentWindowEntries,
  mapNullableProviderResult,
} from "./result-helpers.js";

export const ollamaProvider: QuotaProvider = {
  id: "ollama",

  async isAvailable(ctx: QuotaProviderContext): Promise<boolean> {
    const providerAvailable = await isCanonicalProviderAvailable({
      ctx,
      providerId: "ollama",
      fallbackOnError: false,
    });
    if (providerAvailable) return true;

    return await hasOllamaApiKeyConfigured();
  },

  matchesCurrentModel(model: string): boolean {
    const lower = model.toLowerCase();
    const provider = lower.split("/")[0];
    return provider === "ollama" || lower.includes("ollama");
  },

  async fetch(ctx: QuotaProviderContext): Promise<QuotaProviderResult> {
    const result = await queryOllamaQuota({
      requestTimeoutMs: ctx.config?.requestTimeoutMs,
    });

    return mapNullableProviderResult(result, {
      errorLabel: "Ollama",
      onSuccess: (result) =>
        attemptedResult(
          groupedPercentWindowEntries({
            group: result.label,
            windows: [
              { window: result.windows.session, suffix: "5h", label: "Session:" },
              { window: result.windows.weekly, suffix: "Weekly", label: "Weekly:" },
            ],
          }),
          [],
          {
            singleWindowDisplayName: result.label,
          },
        ),
    });
  },
};
