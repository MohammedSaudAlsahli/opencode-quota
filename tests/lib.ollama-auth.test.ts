import { homedir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRuntimePathsMockModule,
  getTrustedOpencodeConfigPaths,
  getWorkspaceOpencodeConfigPaths,
  loadFsConfigMocks,
  mockTrustedConfigFile,
  resetFsConfigMocks,
  resetProcessEnv,
} from "./helpers/trusted-config-test-harness.js";

const mocks = vi.hoisted(() => ({
  getAuthPaths: vi.fn(() => ["/tmp/auth.json"]),
  readAuthFileCached: vi.fn(),
}));

vi.mock("../src/lib/opencode-runtime-paths.js", () => createRuntimePathsMockModule());

vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("../src/lib/opencode-auth.js", () => ({
  getAuthPaths: mocks.getAuthPaths,
  readAuthFileCached: mocks.readAuthFileCached,
}));

import {
  DEFAULT_OLLAMA_AUTH_CACHE_MAX_AGE_MS,
  getOpencodeConfigCandidatePaths,
  getOllamaAuthDiagnostics,
  hasOllamaApiKeyConfigured,
  resolveOllamaAuth,
  resolveOllamaAuthCached,
} from "../src/lib/ollama-auth.js";

const withOllamaAuth = (entry: unknown) => ({
  ollama: entry,
});

describe("ollama auth resolution", () => {
  const originalEnv = process.env;
  const trustedPaths = getTrustedOpencodeConfigPaths();
  const workspacePaths = getWorkspaceOpencodeConfigPaths();
  const expectedTrustedCandidates = [
    { path: join(homedir(), ".config", "opencode", "opencode.jsonc"), isJsonc: true },
    { path: join(homedir(), ".config", "opencode", "opencode.json"), isJsonc: false },
  ];
  let fsConfigMocks: Awaited<ReturnType<typeof loadFsConfigMocks>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetProcessEnv(originalEnv, ["OLLAMA_API_KEY"]);

    mocks.getAuthPaths.mockReset().mockReturnValue(["/tmp/auth.json"]);
    mocks.readAuthFileCached.mockReset();

    fsConfigMocks = await loadFsConfigMocks();
  });

  afterEach(() => {
    resetFsConfigMocks(fsConfigMocks);
    resetProcessEnv(originalEnv, ["OLLAMA_API_KEY"]);
  });

  it("returns none when no auth is configured", async () => {
    mocks.readAuthFileCached.mockResolvedValue(null);
    const result = resolveOllamaAuth(null);
    expect(result).toEqual({ state: "none" });
  });

  it("returns configured for valid API auth entry", async () => {
    mocks.readAuthFileCached.mockResolvedValue(
      withOllamaAuth({ type: "api", key: "sk-test-ollama-key" }),
    );
    const result = await resolveOllamaAuthCached();
    expect(result.state).toBe("configured");
    if (result.state === "configured") {
      expect(result.apiKey).toBe("sk-test-ollama-key");
    }
  });

  it("returns invalid for non-api type", () => {
    const result = resolveOllamaAuth(withOllamaAuth({ type: "oauth", key: "test" }));
    expect(result.state).toBe("invalid");
    if (result.state === "invalid") {
      expect(result.error).toContain("Unsupported Ollama auth type");
    }
  });

  it("returns invalid for empty key", () => {
    const result = resolveOllamaAuth(withOllamaAuth({ type: "api", key: "" }));
    expect(result.state).toBe("invalid");
  });

  it("returns invalid for missing key", () => {
    const result = resolveOllamaAuth(withOllamaAuth({ type: "api" }));
    expect(result.state).toBe("invalid");
  });

  it("resolves OLLAMA_API_KEY from environment", async () => {
    process.env.OLLAMA_API_KEY = "env-ollama-key";
    mocks.readAuthFileCached.mockResolvedValue(null);

    const result = await resolveOllamaAuthCached();
    expect(result.state).toBe("configured");
    if (result.state === "configured") {
      expect(result.apiKey).toBe("env-ollama-key");
    }
  });

  it("resolves from ollama-cloud auth key", () => {
    const data = {
      "ollama-cloud": { type: "api", key: "cloud-key" },
    };
    const result = resolveOllamaAuth(data);
    expect(result.state).toBe("configured");
    if (result.state === "configured") {
      expect(result.apiKey).toBe("cloud-key");
    }
  });

  it("prefers ollama key over ollama-cloud key", () => {
    const data = {
      ollama: { type: "api", key: "primary-key" },
      "ollama-cloud": { type: "api", key: "secondary-key" },
    };
    const result = resolveOllamaAuth(data);
    expect(result.state).toBe("configured");
    if (result.state === "configured") {
      expect(result.apiKey).toBe("primary-key");
    }
  });

  it("returns diagnostics when no auth configured", async () => {
    mocks.readAuthFileCached.mockResolvedValue(null);
    const diag = await getOllamaAuthDiagnostics();
    expect(diag.state).toBe("none");
    expect(diag.source).toBeNull();
  });

  it("has a 5-second default auth cache max age", () => {
    expect(DEFAULT_OLLAMA_AUTH_CACHE_MAX_AGE_MS).toBe(5_000);
  });

  it("returns trusted candidate paths matching expected", () => {
    const candidates = getOpencodeConfigCandidatePaths();
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0].isJsonc).toBe(true);
    expect(candidates[0].path).toMatch(/opencode\.jsonc$/);
    expect(candidates[1].isJsonc).toBe(false);
    expect(candidates[1].path).toMatch(/opencode\.json$/);
  });

  it("hasOllamaApiKeyConfigured returns true when auth is configured", async () => {
    mocks.readAuthFileCached.mockResolvedValue(
      withOllamaAuth({ type: "api", key: "test-key" }),
    );
    const result = await hasOllamaApiKeyConfigured();
    expect(result).toBe(true);
  });

  it("hasOllamaApiKeyConfigured returns false when auth is none", async () => {
    mocks.readAuthFileCached.mockResolvedValue(null);
    const result = await hasOllamaApiKeyConfigured();
    expect(result).toBe(false);
  });
});
