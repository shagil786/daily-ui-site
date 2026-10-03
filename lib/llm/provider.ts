import { createAnthropicProvider } from "./anthropic";
import { createOpenAiProvider } from "./openai";

/** A raw text/JSON generator: prompt in, provider content string out. */
export interface LlmProvider {
  generate(prompt: string, opts?: { repair?: string }): Promise<string>;
}

/** Runtime-selected via env LLM_PROVIDER; wired by the generation pipeline. */
export type LlmProviderName = "openai" | "anthropic";

/**
 * Default ceiling on one provider call. Generous, because compatible hosts can
 * be genuinely slow — a cold reasoning model was measured at ~260s — but not
 * unbounded: live testing found a host that accepted a request and held the
 * connection open with no response at all, which would otherwise pin a server
 * thread forever. Override with `LLM_TIMEOUT_MS`.
 */
export const DEFAULT_TIMEOUT_MS = 600_000;

/** A positive whole number of milliseconds, or undefined when unusable. */
export function parseTimeoutMs(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Shared transport helper for both providers: POST JSON, parse the JSON
 * response. Non-2xx responses throw an Error whose `status` property carries
 * the HTTP status code so the pipeline can treat API failures as failures.
 * Never performs retries — one call, one result or one throw. The request is
 * bounded by `timeoutMs` (default {@link DEFAULT_TIMEOUT_MS}).
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      detail = "";
    }
    const suffix = detail.length > 0 ? `: ${detail.slice(0, 500)}` : "";
    const error = new Error(
      `LLM request to ${url} failed with status ${response.status}${suffix}`,
    ) as Error & { status: number };
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as unknown;
}

/**
 * Build the provider for `name`. Throws on unknown names (including values
 * smuggled past the type system) so misconfigured env wiring fails fast.
 */
export function createProvider(name: LlmProviderName, apiKey: string): LlmProvider {
  switch (name) {
    case "openai":
      return createOpenAiProvider(apiKey);
    case "anthropic":
      return createAnthropicProvider(apiKey);
    default: {
      const unknownName: never = name;
      throw new Error(`unknown LLM provider: ${String(unknownName)}`);
    }
  }
}
