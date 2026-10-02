import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtractError, extractJson } from "../../lib/llm/extract";
import { createProvider } from "../../lib/llm/provider";

/** Minimal Response stand-in so tests never depend on real network or undici. */
function mockResponse(data: unknown, status = 200): Response {
  const body = JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => body,
  } as unknown as Response;
}

function parsedBody(init: RequestInit | undefined): Record<string, unknown> {
  const raw: unknown = JSON.parse(String(init?.body));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("request body is not a JSON object");
  }
  return raw as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extractJson", () => {
  it("extracts an object with prefix and suffix around it", () => {
    expect(extractJson('prefix {"a":1} suffix')).toEqual({ a: 1 });
  });

  it("extracts an object wrapped in a markdown code fence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("throws ExtractError on an unbalanced object", () => {
    expect(() => extractJson('{"broken"')).toThrow(ExtractError);
  });

  it("extracts a nested object/array structure in full", () => {
    expect(extractJson('{"nested":{"arr":[1,2]}}')).toEqual({ nested: { arr: [1, 2] } });
  });

  it("ignores braces inside string values", () => {
    expect(extractJson('{"text":"close } and open { inside","n":2}')).toEqual({
      text: "close } and open { inside",
      n: 2,
    });
  });

  it("handles backslash escapes inside strings", () => {
    expect(extractJson('{"a":"she said \\"hi\\" and \\\\ end"}')).toEqual({
      a: 'she said "hi" and \\ end',
    });
    // trailing escaped backslash must not leave the scanner inside the string
    expect(extractJson('{"b":"ends with backslash \\\\"}')).toEqual({
      b: "ends with backslash \\",
    });
  });

  it("extracts a top-level array containing nested containers", () => {
    expect(extractJson('Result: [1, [2, 3], {"k":"v"}] done')).toEqual([
      1,
      [2, 3],
      { k: "v" },
    ]);
  });

  it("throws ExtractError when no container is present", () => {
    expect(() => extractJson("no json here")).toThrow(ExtractError);
  });

  it("throws ExtractError when the first balanced candidate is not valid JSON", () => {
    expect(() => extractJson("{not json}")).toThrow(ExtractError);
  });
});

describe("createProvider", () => {
  it("throws on an unknown provider name", () => {
    expect(() => createProvider("bogus" as never, "key")).toThrow();
  });

  it("returns a provider with generate() for each known name", () => {
    expect(typeof createProvider("openai", "sk-test").generate).toBe("function");
    expect(typeof createProvider("anthropic", "sk-ant-test").generate).toBe("function");
  });
});

describe("openai provider", () => {
  it("posts chat/completions with response_format json_object and returns the content string", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        mockResponse({ choices: [{ message: { content: '{"ok":true}' } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createProvider("openai", "sk-test");
    await expect(provider.generate("build a hero")).resolves.toBe('{"ok":true}');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer sk-test",
    });

    const body = parsedBody(init);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "user", content: "build a hero" })]),
    );
  });

  it("appends opts.repair as an extra message", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        mockResponse({ choices: [{ message: { content: "{}" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createProvider("openai", "sk-test");
    await provider.generate("first prompt", { repair: "prior output was invalid: missing root" });

    const body = parsedBody(fetchMock.mock.calls[0][1]);
    expect(body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "prior output was invalid: missing root" }),
      ]),
    );
  });

  it("throws an Error carrying the status on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> =>
        mockResponse({ error: { message: "boom" } }, 500),
      ),
    );

    const provider = createProvider("openai", "sk-test");
    await expect(provider.generate("anything")).rejects.toThrow(/status 500/);
  });
});

describe("anthropic provider", () => {
  it("posts /v1/messages with a forced submit_ui tool and returns text block content", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        mockResponse({ content: [{ type: "text", text: '{"root":{}}' }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createProvider("anthropic", "sk-ant-test");
    await expect(provider.generate("build a hero")).resolves.toBe('{"root":{}}');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      "x-api-key": "sk-ant-test",
      "anthropic-version": "2023-06-01",
    });

    const body = parsedBody(init);
    expect(body.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "submit_ui" })]),
    );
    expect(body.tool_choice).toEqual({ type: "tool", name: "submit_ui" });
    expect(body.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "user", content: "build a hero" })]),
    );
  });

  it("returns the forced tool_use input as a JSON string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> =>
        mockResponse({
          content: [{ type: "tool_use", id: "toolu_1", name: "submit_ui", input: { root: { id: "r" } } }],
        }),
      ),
    );

    const provider = createProvider("anthropic", "sk-ant-test");
    await expect(provider.generate("build")).resolves.toBe('{"root":{"id":"r"}}');
  });

  it("appends opts.repair as an extra user message", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        mockResponse({ content: [{ type: "text", text: "{}" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createProvider("anthropic", "sk-ant-test");
    await provider.generate("first prompt", { repair: "prior output was invalid: bad props" });

    const body = parsedBody(fetchMock.mock.calls[0][1]);
    expect(body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "prior output was invalid: bad props" }),
      ]),
    );
  });

  it("throws an Error carrying the status on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> =>
        mockResponse({ error: { type: "overloaded_error" } }, 529),
      ),
    );

    const provider = createProvider("anthropic", "sk-ant-test");
    await expect(provider.generate("anything")).rejects.toThrow(/status 529/);
  });
});
