import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasOllamaApiKeyConfigured: vi.fn(),
  queryOllamaQuota: vi.fn(),
  isCanonicalProviderAvailable: vi.fn(),
}));

vi.mock("../src/lib/ollama-auth.js", () => ({
  hasOllamaApiKeyConfigured: mocks.hasOllamaApiKeyConfigured,
}));

vi.mock("../src/lib/ollama.js", () => ({
  queryOllamaQuota: mocks.queryOllamaQuota,
}));

vi.mock("../src/lib/provider-availability.js", () => ({
  isCanonicalProviderAvailable: mocks.isCanonicalProviderAvailable,
}));

import { ollamaProvider } from "../src/providers/ollama.js";
import type { QuotaProviderContext } from "../src/lib/entries.js";

const makeCtx = (overrides?: Partial<QuotaProviderContext>): QuotaProviderContext => ({
  client: {
    config: {
      providers: async () => ({ data: { providers: [] } }),
      get: async () => ({ data: {} }),
    },
  },
  config: {
    googleModels: ["CLAUDE"],
    enabledProviders: "auto",
  },
  ...overrides,
});

describe("ollama provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct id", () => {
    expect(ollamaProvider.id).toBe("ollama");
  });

  it("matches ollama models", () => {
    expect(ollamaProvider.matchesCurrentModel?.("ollama/llama3")).toBe(true);
    expect(ollamaProvider.matchesCurrentModel?.("ollama/gemma3")).toBe(true);
    expect(ollamaProvider.matchesCurrentModel?.("openai/gpt-4")).toBe(false);
    expect(ollamaProvider.matchesCurrentModel?.("anthropic/claude")).toBe(false);
  });

  it("is available when provider is present in OpenCode config", async () => {
    mocks.isCanonicalProviderAvailable.mockResolvedValue(true);
    mocks.hasOllamaApiKeyConfigured.mockResolvedValue(false);

    const available = await ollamaProvider.isAvailable(makeCtx());
    expect(available).toBe(true);
  });

  it("is available when provider is not present but API key is configured", async () => {
    mocks.isCanonicalProviderAvailable.mockResolvedValue(false);
    mocks.hasOllamaApiKeyConfigured.mockResolvedValue(true);

    const available = await ollamaProvider.isAvailable(makeCtx());
    expect(available).toBe(true);
  });

  it("is not available when provider is not present and no API key", async () => {
    mocks.isCanonicalProviderAvailable.mockResolvedValue(false);
    mocks.hasOllamaApiKeyConfigured.mockResolvedValue(false);

    const available = await ollamaProvider.isAvailable(makeCtx());
    expect(available).toBe(false);
  });

  it("is available when provider is present regardless of API key", async () => {
    mocks.isCanonicalProviderAvailable.mockResolvedValue(true);
    mocks.hasOllamaApiKeyConfigured.mockResolvedValue(false);

    const available = await ollamaProvider.isAvailable(makeCtx());
    expect(available).toBe(true);
  });

  it("returns attempted result with quota data on success", async () => {
    mocks.queryOllamaQuota.mockResolvedValue({
      success: true,
      label: "Ollama (pro)",
      windows: {
        session: { percentRemaining: 85 },
        weekly: { percentRemaining: 70, resetTimeIso: "2026-05-23T00:00:00.000Z" },
      },
    });

    const result = await ollamaProvider.fetch(makeCtx());
    expect(result.attempted).toBe(true);
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("returns not attempted when quota is null", async () => {
    mocks.queryOllamaQuota.mockResolvedValue(null);

    const result = await ollamaProvider.fetch(makeCtx());
    expect(result.attempted).toBe(false);
    expect(result.entries).toEqual([]);
  });

  it("returns error result when quota fails", async () => {
    mocks.queryOllamaQuota.mockResolvedValue({
      success: false,
      error: "Ollama Cloud auth failed",
    });

    const result = await ollamaProvider.fetch(makeCtx());
    expect(result.attempted).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].label).toBe("Ollama");
  });
});
