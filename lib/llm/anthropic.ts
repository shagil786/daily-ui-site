import { parseTimeoutMs, postJson, type LlmProvider } from "./provider";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5-5";
const API_VERSION = "2023-06-01";

/**
 * Structured output via forced tool use: the model must call `submit_ui`
 * with the UI document as the tool input. The schema stays permissive —
 * the pipeline validates the parsed document against the zod schema.
 */
const SUBMIT_TOOL = {
  name: "submit_ui",
  description:
    "Submit the generated UI document. The input must be the single JSON object requested in the conversation.",
  input_schema: { type: "object" },
} as const;

type AnthropicMessage = { role: "user" | "assistant"; content: string };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Prefer the forced `submit_ui` tool input (serialized back to a JSON string
 * so `extractJson` can parse it uniformly); fall back to concatenated text
 * blocks when the response carries none.
 */
function readContent(data: unknown): string {
  const content = asRecord(data)?.content;
  if (!Array.isArray(content)) {
    throw new Error("anthropic: response is missing a content array");
  }

  let text = "";
  for (const block of content) {
    const record = asRecord(block);
    if (record === undefined) {
      continue;
    }
    if (record.type === "tool_use") {
      const serialized = JSON.stringify(record.input);
      if (typeof serialized === "string") {
        return serialized;
      }
    }
    if (record.type === "text" && typeof record.text === "string") {
      text += record.text;
    }
  }

  if (text.length === 0) {
    throw new Error("anthropic: response contains no submit_ui tool_use or text block");
  }
  return text;
}

export function createAnthropicProvider(apiKey: string): LlmProvider {
  return {
    async generate(prompt: string, opts?: { repair?: string }): Promise<string> {
      const messages: AnthropicMessage[] = [{ role: "user", content: prompt }];
      // One repair attempt: consecutive user turns are combined by the API,
      // so this lands as a follow-up turn on the same request.
      if (opts?.repair !== undefined) {
        messages.push({ role: "user", content: opts.repair });
      }

      const data = await postJson(
        ENDPOINT,
        { "x-api-key": apiKey, "anthropic-version": API_VERSION },
        {
          model: MODEL,
          max_tokens: 8192,
          system:
            "You are a UI generator. Call the submit_ui tool with exactly one JSON object and nothing else.",
          tools: [SUBMIT_TOOL],
          tool_choice: { type: "tool", name: "submit_ui" },
          messages,
        },
        parseTimeoutMs(process.env.LLM_TIMEOUT_MS),
      );
      return readContent(data);
    },
  };
}
