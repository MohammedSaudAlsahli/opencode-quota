import { clampPercent } from "./format-utils.js";
import { sanitizeDisplaySnippet, sanitizeDisplayText } from "./display-sanitize.js";
import { fetchWithTimeout } from "./http.js";
import type { OllamaMeResponse, OllamaResult } from "./types.js";
import { resolveOllamaAuthCached } from "./ollama-auth.js";

const OLLAMA_ME_URL = "https://ollama.com/api/me";

export async function queryOllamaQuota(options: {
  requestTimeoutMs?: number;
} = {}): Promise<OllamaResult> {
  const auth = await resolveOllamaAuthCached();
  if (auth.state === "none") return null;
  if (auth.state === "invalid") {
    return { success: false, error: auth.error };
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.apiKey}`,
      "User-Agent": "OpenCode-Quota-Toast/1.0",
      "Content-Type": "application/json",
    };

    const resp = await fetchWithTimeout(
      OLLAMA_ME_URL,
      { method: "POST", headers },
      options.requestTimeoutMs,
    );

    if (!resp.ok) {
      const text = await resp.text();
      if (resp.status === 401 || resp.status === 403) {
        return { success: false, error: "Ollama Cloud auth failed (check API key)" };
      }
      return {
        success: false,
        error: `Ollama Cloud API error ${resp.status}: ${sanitizeDisplaySnippet(text, 120)}`,
      };
    }

    const data = (await resp.json()) as OllamaMeResponse;
    const plan = data.Plan ?? data.plan ?? "unknown";
    const label = `Ollama (${plan})`;

    let sessionWindow: { percentRemaining: number; resetTimeIso?: string } | undefined;
    let weeklyWindow: { percentRemaining: number; resetTimeIso?: string } | undefined;

    const sessionPercent = extractPercent(data, [
      "SessionUsagePercent",
      "session_usage_percent",
      "session_used_percentage",
      "session_percent",
      "session_usage",
    ]);
    if (typeof sessionPercent === "number") {
      const percentRemaining = clampPercent(100 - sessionPercent);
      sessionWindow = { percentRemaining };
    }

    const weeklyPercent = extractPercent(data, [
      "WeeklyUsagePercent",
      "weekly_usage_percent",
      "weekly_used_percentage",
      "weekly_percent",
      "weekly_usage",
    ]);
    if (typeof weeklyPercent === "number") {
      const percentRemaining = clampPercent(100 - weeklyPercent);
      weeklyWindow = { percentRemaining };
    }

    const sessionResetsAt = extractResetTime(data, [
      "SessionResetsAt",
      "session_resets_at",
      "session_reset_time",
      "session_reset",
    ]);
    if (sessionWindow && sessionResetsAt) {
      sessionWindow.resetTimeIso = sessionResetsAt;
    }

    const weeklyResetsAt = extractResetTime(data, [
      "WeeklyResetsAt",
      "weekly_resets_at",
      "weekly_reset_time",
      "weekly_reset",
    ]);
    if (weeklyWindow && weeklyResetsAt) {
      weeklyWindow.resetTimeIso = weeklyResetsAt;
    }

    if (!sessionWindow && !weeklyWindow) {
      const subscriptionEnd = extractResetTime(data, [
        "SubscriptionPeriodEnd",
        "subscription_period_end",
        "subscriptionPeriodEnd",
      ]);
      const subscriptionPercent = extractPercent(data, [
        "usage_percent",
        "used_percentage",
        "usage_percentage",
        "UsagePercent",
        "UsedPercent",
      ]);

      if (typeof subscriptionPercent === "number") {
        weeklyWindow = {
          percentRemaining: clampPercent(100 - subscriptionPercent),
          ...(subscriptionEnd ? { resetTimeIso: subscriptionEnd } : {}),
        };
      }

      if (sessionWindow === undefined && weeklyWindow === undefined) {
        sessionWindow = { percentRemaining: 100 };
      }
    }

    return {
      success: true,
      label,
      windows: {
        session: sessionWindow,
        weekly: weeklyWindow,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: sanitizeDisplayText(err instanceof Error ? err.message : String(err)),
    };
  }
}

function extractPercent(data: OllamaMeResponse, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function extractResetTime(data: OllamaMeResponse, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) {
      const date = new Date(value);
      if (Number.isFinite(date.getTime())) {
        return date.toISOString();
      }
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return new Date(value).toISOString();
    }
    // Go sql.NullTime pattern: { Time: "...", Valid: true }
    if (value !== null && typeof value === "object" && value !== undefined) {
      const obj = value as Record<string, unknown>;
      const time = obj.Time ?? obj.time;
      if (typeof time === "string" && time.length > 0) {
        const date = new Date(time);
        if (Number.isFinite(date.getTime())) {
          return date.toISOString();
        }
      }
    }
  }
  return undefined;
}
