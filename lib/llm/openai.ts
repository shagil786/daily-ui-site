import { postJson, type LlmProvider } from "./provider";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-5.4";

/**
 * JSON mode requires the word "JSON" somewhere in the messages, and the
 * instruction keeps output parseable even if response_format is ignored.
 */
const SYSTEM_PROMPT =
  "You are a UI generator. Reply with exactly one JSON object and nothing else: no prose, no markdown fences.";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

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

export function createOpenAiProvider(apiKey: string): LlmProvider {
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

      const data = await postJson(
        ENDPOINT,
        { authorization: `Bearer ${apiKey}` },
        {
          model: MODEL,
          messages,
          response_format: { type: "json_object" },
        },
      );
      return readContent(data);
    },
  };
}
