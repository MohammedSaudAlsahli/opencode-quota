import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveOllamaAuthCached: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

vi.mock("../src/lib/ollama-auth.js", () => ({
  resolveOllamaAuthCached: mocks.resolveOllamaAuthCached,
  DEFAULT_OLLAMA_AUTH_CACHE_MAX_AGE_MS: 5_000,
}));

vi.mock("../src/lib/http.js", () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
}));

vi.mock("../src/lib/format-utils.js", () => ({
  clampPercent: (v: number) => Math.max(0, Math.min(100, v)),
}));

vi.mock("../src/lib/display-sanitize.js", () => ({
  sanitizeDisplaySnippet: (v: string, maxLen: number) => v.slice(0, maxLen),
  sanitizeDisplayText: (v: string) => v,
}));

import { queryOllamaQuota } from "../src/lib/ollama.js";

describe("queryOllamaQuota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when auth state is none", async () => {
    mocks.resolveOllamaAuthCached.mockResolvedValue({ state: "none" });
    const result = await queryOllamaQuota();
    expect(result).toBeNull();
  });

  it("returns error when auth state is invalid", async () => {
    mocks.resolveOllamaAuthCached.mockResolvedValue({
      state: "invalid",
      error: "Test error",
    });
    const result = await queryOllamaQuota();
    expect(result).toEqual({
      success: false,
      error: "Test error",
    });
  });

  it("returns error on API failure", async () => {
    mocks.resolveOllamaAuthCached.mockResolvedValue({
      state: "configured",
      apiKey: "test-key",
    });
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });
    const result = await queryOllamaQuota();
    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("500"),
    });
  });

  it("returns error on 401 auth failure", async () => {
    mocks.resolveOllamaAuthCached.mockResolvedValue({
      state: "configured",
      apiKey: "bad-key",
    });
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    const result = await queryOllamaQuota();
    expect(result).toEqual({
      success: false,
      error: "Ollama Cloud auth failed (check API key)",
    });
  });

  it("returns quota with session and weekly windows when available", async () => {
    mocks.resolveOllamaAuthCached.mockResolvedValue({
      state: "configured",
      apiKey: "test-key",
    });
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({
        plan: "pro",
        session_usage_percent: 25,
        weekly_usage_percent: 40,
        session_resets_at: "2026-05-16T03:00:00Z",
        weekly_resets_at: "2026-05-23T00:00:00Z",
      }),
    });
    const result = await queryOllamaQuota();
    expect(result).not.toBeNull();
    if (result && result.success) {
      expect(result.label).toBe("Ollama (pro)");
      expect(result.windows.session).toBeDefined();
      expect(result.windows.session?.percentRemaining).toBe(75);
      expect(result.windows.weekly).toBeDefined();
      expect(result.windows.weekly?.percentRemaining).toBe(60);
    }
  });

  it("returns quota with only plan when no usage data is available", async () => {
    mocks.resolveOllamaAuthCached.mockResolvedValue({
      state: "configured",
      apiKey: "test-key",
    });
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({
        plan: "free",
      }),
    });
    const result = await queryOllamaQuota();
    expect(result).not.toBeNull();
    if (result && result.success) {
      expect(result.label).toBe("Ollama (free)");
      expect(result.windows.session).toBeDefined();
      expect(result.windows.session?.percentRemaining).toBe(100);
    }
  });

  it("handles network errors gracefully", async () => {
    mocks.resolveOllamaAuthCached.mockResolvedValue({
      state: "configured",
      apiKey: "test-key",
    });
    mocks.fetchWithTimeout.mockRejectedValue(new Error("Network error"));
    const result = await queryOllamaQuota();
    expect(result).toEqual({
      success: false,
      error: "Network error",
    });
  });

  it("handles invalid JSON response", async () => {
    mocks.resolveOllamaAuthCached.mockResolvedValue({
      state: "configured",
      apiKey: "test-key",
    });
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("Invalid JSON");
      },
    });
    const result = await queryOllamaQuota();
    expect(result).toEqual({
      success: false,
      error: "Invalid JSON",
    });
  });

  it("uses session window from subscription data when direct fields are missing", async () => {
    mocks.resolveOllamaAuthCached.mockResolvedValue({
      state: "configured",
      apiKey: "test-key",
    });
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({
        plan: "max",
        usage_percent: 65,
        subscription_period_end: "2026-06-01T00:00:00Z",
      }),
    });
    const result = await queryOllamaQuota();
    expect(result).not.toBeNull();
    if (result && result.success) {
      expect(result.label).toBe("Ollama (max)");
      expect(result.windows.weekly).toBeDefined();
      expect(result.windows.weekly?.percentRemaining).toBe(35);
      expect(result.windows.weekly?.resetTimeIso).toBe(
        new Date("2026-06-01T00:00:00Z").toISOString(),
      );
    }
  });
});
