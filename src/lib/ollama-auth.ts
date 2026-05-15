import {
  extractProviderOptionsApiKey,
  getApiKeyCheckedPaths,
  getGlobalOpencodeConfigCandidatePaths,
  resolveApiKeyFromEnvAndConfig,
} from "./api-key-resolver.js";
import { sanitizeDisplayText } from "./display-sanitize.js";
import { getAuthPaths, readAuthFileCached } from "./opencode-auth.js";

import type { AuthData, OllamaAuthData } from "./types.js";

export const DEFAULT_OLLAMA_AUTH_CACHE_MAX_AGE_MS = 5_000;
const OLLAMA_AUTH_KEYS = ["ollama", "ollama-cloud"] as const;
const OLLAMA_PROVIDER_KEYS = ["ollama", "ollama-cloud"] as const;
const ALLOWED_OLLAMA_ENV_VARS = ["OLLAMA_API_KEY"] as const;

export type OllamaKeySource =
  | "env:OLLAMA_API_KEY"
  | "opencode.json"
  | "opencode.jsonc"
  | "auth.json";

export type ResolvedOllamaAuth =
  | { state: "none" }
  | { state: "configured"; apiKey: string }
  | { state: "invalid"; error: string };

export type OllamaAuthDiagnostics =
  | {
      state: "none";
      source: null;
      checkedPaths: string[];
      authPaths: string[];
    }
  | {
      state: "configured";
      source: OllamaKeySource;
      checkedPaths: string[];
      authPaths: string[];
    }
  | {
      state: "invalid";
      source: "auth.json";
      checkedPaths: string[];
      authPaths: string[];
      error: string;
    };

export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

function getOllamaAuthEntry(auth: AuthData | null | undefined): unknown {
  for (const key of OLLAMA_AUTH_KEYS) {
    if (auth && Object.prototype.hasOwnProperty.call(auth, key)) {
      return auth[key as keyof AuthData];
    }
  }
  return undefined;
}

function isOllamaAuthData(value: unknown): value is OllamaAuthData {
  return value !== null && typeof value === "object";
}

function sanitizeOllamaAuthValue(value: string): string {
  const sanitized = sanitizeDisplayText(value).replace(/\s+/g, " ").trim();
  return (sanitized || "unknown").slice(0, 120);
}

export function resolveOllamaAuth(auth: AuthData | null | undefined): ResolvedOllamaAuth {
  const ollama = getOllamaAuthEntry(auth);
  if (ollama === null || ollama === undefined) {
    return { state: "none" };
  }

  if (!isOllamaAuthData(ollama)) {
    return { state: "invalid", error: "Ollama auth entry has invalid shape" };
  }

  if (typeof ollama.type !== "string") {
    return { state: "invalid", error: "Ollama auth entry present but type is missing or invalid" };
  }

  if (ollama.type !== "api") {
    return {
      state: "invalid",
      error: `Unsupported Ollama auth type: "${sanitizeOllamaAuthValue(ollama.type)}"`,
    };
  }

  const key = typeof ollama.key === "string" ? ollama.key.trim() : "";
  if (!key) {
    return { state: "invalid", error: "Ollama auth entry present but key is empty" };
  }

  return { state: "configured", apiKey: key };
}

async function resolveOllamaAuthWithSource(params?: {
  maxAgeMs?: number;
}): Promise<{ auth: ResolvedOllamaAuth; source: OllamaKeySource | null }> {
  const resolvedFromEnvOrConfig = await resolveApiKeyFromEnvAndConfig<OllamaKeySource>({
    envVars: [{ name: "OLLAMA_API_KEY", source: "env:OLLAMA_API_KEY" as const }],
    extractFromConfig: (config) =>
      extractProviderOptionsApiKey(config, {
        providerKeys: OLLAMA_PROVIDER_KEYS,
        allowedEnvVars: ALLOWED_OLLAMA_ENV_VARS,
      }),
    configJsonSource: "opencode.json",
    configJsoncSource: "opencode.jsonc",
    getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
  });

  if (resolvedFromEnvOrConfig) {
    return {
      auth: { state: "configured", apiKey: resolvedFromEnvOrConfig.key },
      source: resolvedFromEnvOrConfig.source,
    };
  }

  const maxAgeMs = Math.max(0, params?.maxAgeMs ?? DEFAULT_OLLAMA_AUTH_CACHE_MAX_AGE_MS);
  const authData = await readAuthFileCached({ maxAgeMs });
  const auth = resolveOllamaAuth(authData);

  return {
    auth,
    source: auth.state === "none" ? null : "auth.json",
  };
}

export async function resolveOllamaAuthCached(params?: {
  maxAgeMs?: number;
}): Promise<ResolvedOllamaAuth> {
  return (await resolveOllamaAuthWithSource(params)).auth;
}

export async function hasOllamaApiKeyConfigured(): Promise<boolean> {
  const auth = await resolveOllamaAuthCached();
  return auth.state === "configured";
}

export async function getOllamaAuthDiagnostics(params?: {
  maxAgeMs?: number;
}): Promise<OllamaAuthDiagnostics> {
  const { auth, source } = await resolveOllamaAuthWithSource(params);
  const checkedPaths = getApiKeyCheckedPaths({
    envVarNames: [...ALLOWED_OLLAMA_ENV_VARS],
    getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
  });
  const authPaths = getAuthPaths();

  if (auth.state === "none") {
    return {
      state: "none",
      source: null,
      checkedPaths,
      authPaths,
    };
  }

  if (auth.state === "invalid") {
    return {
      state: "invalid",
      source: "auth.json",
      checkedPaths,
      authPaths,
      error: auth.error,
    };
  }

  return {
    state: "configured",
    source: source ?? "auth.json",
    checkedPaths,
    authPaths,
  };
}
