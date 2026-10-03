import { parseTimeoutMs, postJson, type LlmProvider } from "./provider";

/** Defaults are OpenAI's; any OpenAI-compatible host overrides them via env. */
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.4";

/**
 * Transport overrides for OpenAI-compatible endpoints (NVIDIA NIM, Together,
 * a local gateway, …). Each falls back to `process.env`, then to the OpenAI
 * default, so an unconfigured deployment behaves exactly as before.
 */
export type OpenAiOptions = {
  /** Base URL including the version segment; `/chat/completions` is appended. */
  baseUrl?: string;
  model?: string;
  /**
   * Sent only when set. Many compatible hosts cap output by default well below
   * what a full UI document needs, which truncates the JSON into an extraction
   * failure — so operators of those hosts should raise it. Omitted by default
   * because OpenAI's newer reasoning models reject the deprecated field.
   */
  maxTokens?: number;
};

/** Resolve one option: explicit argument, then env, then the built-in default. */
function setting(explicit: string | undefined, envValue: string | undefined, fallback: string): string {
  const chosen = explicit ?? envValue;
  return chosen === undefined || chosen.trim().length === 0 ? fallback : chosen.trim();
}

/** `base` + `/chat/completions`, tolerating a trailing slash on the base. */
function endpointFor(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/**
 * JSON mode requires the word "JSON" somewhere in the messages, and the
 * instruction keeps output parseable even if response_format is ignored.
 */
const SYSTEM_PROMPT =
  "You are a UI generator. Reply with exactly one JSON object and nothing else: no prose, no markdown fences.";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** A positive whole number, or undefined — an unusable value is ignored, not sent. */
function parseMaxTokens(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  return positiveInteger(Number(raw.trim()));
}

/** Same rule for the explicit option, so `NaN` or a non-positive value is dropped. */
function positiveInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Narrow the chat-completions response to `choices[0].message.content`. */
function readContent(data: unknown): string {
  const choices = asRecord(data)?.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const content = asRecord(asRecord(first)?.message)?.content;
  if (typeof content !== "string") {
    throw new Error("openai: response is missing choices[0].message.content string");
  }
  return content;
}

export function createOpenAiProvider(
  apiKey: string,
  options: OpenAiOptions = {},
): LlmProvider {
  const endpoint = endpointFor(
    setting(options.baseUrl, process.env.LLM_BASE_URL, DEFAULT_BASE_URL),
  );
  const model = setting(options.model, process.env.LLM_MODEL, DEFAULT_MODEL);
  const maxTokens = positiveInteger(options.maxTokens) ?? parseMaxTokens(process.env.LLM_MAX_TOKENS);

  return {
    async generate(prompt: string, opts?: { repair?: string }): Promise<string> {
      const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ];
      // One repair attempt: the pipeline passes instructions plus the prior
      // output as a follow-up turn.
      if (opts?.repair !== undefined) {
        messages.push({ role: "user", content: opts.repair });
      }

      const body: Record<string, unknown> = {
        model,
        messages,
        response_format: { type: "json_object" },
      };
      if (maxTokens !== undefined) {
        body.max_tokens = maxTokens;
      }

      const data = await postJson(
        endpoint,
        { authorization: `Bearer ${apiKey}` },
        body,
        parseTimeoutMs(process.env.LLM_TIMEOUT_MS),
      );
      return readContent(data);
    },
  };
}
