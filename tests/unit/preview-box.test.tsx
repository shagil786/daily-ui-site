import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { PreviewBox } from "../../app/preview-box";
import type { UiDocument } from "../../lib/schema";

/**
 * `PreviewBox` — the visitor-facing "describe your own UI" disclosure.
 *
 * `fetch` is stubbed globally (not mocked per-module): the component talks to
 * `POST /api/preview` over the network, so the test's job is to pin the WIRE
 * contract — request shape, and the mapping from every documented status/body
 * pair to exactly one visitor-facing message. Nothing from a failed response
 * body may reach the visitor, so the error cases are asserted on the rendered
 * text rather than on the payload.
 *
 * The returned document is the same fixture shape used in
 * tests/unit/renderer.test.tsx and tests/unit/theme-surface.test.tsx, so it
 * renders through the real `Renderer` and `ThemeSurface`.
 */

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const BRIEF = "a calm invoice dashboard for freelancers";

/** A document that passes the renderer and carries a distinct title. */
function fixtureDoc(title = "Preview fixture title"): UiDocument {
  return {
    version: 1,
    date: "2026-10-03",
    title,
    theme: { bg: "#101820", fg: "#f2f5f7", accent: "#ff3366", font: "sans", dark: true },
    root: {
      id: "root",
      componentType: "Section",
      props: { heading: "Preview heading" },
      children: [{ id: "t1", componentType: "Text", props: { text: "Body copy" } }],
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: Mock<FetchFn>;

beforeEach(() => {
  fetchMock = vi.fn<FetchFn>(async () => jsonResponse({ doc: fixtureDoc() }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Opens the disclosure and types a brief long enough for the endpoint. */
function fillBrief(value: string = BRIEF): void {
  fireEvent.click(screen.getByTestId("preview-toggle"));
  fireEvent.change(screen.getByTestId("preview-input"), { target: { value } });
}

async function generate(): Promise<void> {
  fireEvent.click(screen.getByTestId("preview-generate"));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
}

describe("PreviewBox", () => {
  it("starts collapsed and shows only the toggle", () => {
    render(<PreviewBox />);

    const toggle = screen.getByTestId("preview-toggle");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Describe your own UI")).not.toBeNull();
    // Nothing from the open panel leaks into the closed disclosure.
    expect(screen.queryByTestId("preview-input")).toBeNull();
    expect(screen.queryByTestId("preview-generate")).toBeNull();
    expect(screen.queryByTestId("preview-region")).toBeNull();
    expect(screen.queryByTestId("preview-summary")).toBeNull();
    expect(screen.queryByTestId("preview-back")).toBeNull();
  });

  it("opens on toggle and exposes a labelled textarea and a generate button", () => {
    render(<PreviewBox />);
    fireEvent.click(screen.getByTestId("preview-toggle"));

    expect(screen.getByTestId("preview-toggle").getAttribute("aria-expanded")).toBe("true");
    const input = screen.getByTestId("preview-input");
    expect(input.tagName).toBe("TEXTAREA");
    // Label by aria-label, not a <label for>: the textarea has no visible
    // text label and must still be nameable.
    expect(input.getAttribute("aria-label")).toBeTruthy();
    expect(screen.getByRole("button", { name: /generate/i })).not.toBeNull();
    // Opening must not talk to the network.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables the generate button while the request is in flight", async () => {
    let settle: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        }),
    );
    render(<PreviewBox />);
    fillBrief();

    // A trimmed brief shorter than the endpoint's 8-character minimum cannot
    // be submitted at all.
    const generateButton = screen.getByTestId("preview-generate") as HTMLButtonElement;
    expect(generateButton.disabled).toBe(false);
    fireEvent.change(screen.getByTestId("preview-input"), { target: { value: "  tiny  " } });
    expect(generateButton.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("preview-input"), { target: { value: BRIEF } });
    fireEvent.click(generateButton);
    expect(generateButton.disabled).toBe(true);

    await act(async () => {
      settle?.(jsonResponse({ error: "unavailable" }, 503));
    });

    await waitFor(() => expect(generateButton.disabled).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 429 cooldown to a retry message with the returned minutes", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "cooldown", retryAfterMinutes: 7 }, 429));
    render(<PreviewBox />);
    fillBrief();
    await generate();

    const alert = await screen.findByTestId("preview-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Try again in 7 minutes");
    expect(screen.queryByTestId("preview-region")).toBeNull();
  });

  it("maps 429 daily-cap, 503 unavailable, 502 generation-failed, and 400 bad-brief to distinct messages", async () => {
    const cases: { status: number; body: unknown; message: string }[] = [
      { status: 429, body: { error: "daily-cap" }, message: "preview budget" },
      { status: 503, body: { error: "unavailable" }, message: "aren't configured right now" },
      {
        status: 502,
        body: { error: "generation-failed" },
        message: "couldn't produce a usable design",
      },
      { status: 400, body: { error: "bad-brief" }, message: "at least 8 characters" },
    ];

    const seen = new Set<string>();
    for (const testCase of cases) {
      fetchMock.mockResolvedValue(jsonResponse(testCase.body, testCase.status));
      render(<PreviewBox />);
      fillBrief();
      await generate();

      const alert = await screen.findByTestId("preview-error");
      expect(alert.textContent).toContain(testCase.message);
      // Distinctness matters: two statuses collapsing to one message would hide
      // a rate limit behind a generic failure.
      expect(seen.has(alert.textContent ?? "")).toBe(false);
      seen.add(alert.textContent ?? "");
      cleanup();
    }
    expect(seen.size).toBe(cases.length);
  });

  it("renders the returned document in the preview region with a preview chip", async () => {
    render(<PreviewBox />);
    fillBrief();
    await generate();

    const region = await screen.findByTestId("preview-region");
    expect(region.textContent).toContain(fixtureDoc().title);
    expect(screen.getByText("preview")).not.toBeNull();
    // A preview has no stored row, so `data-date` must be ABSENT — never today.
    expect(screen.getByTestId("theme-root").hasAttribute("data-date")).toBe(false);
    // The renderer walked the returned tree, not just the title.
    expect(screen.getByText("Preview heading")).not.toBeNull();
    // Wire contract: POST to the preview route with the brief as JSON.
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/preview");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ brief: BRIEF });
  });

  it("collapses to a summary quoting the brief and returns on back", async () => {
    render(<PreviewBox />);
    fillBrief();
    await generate();
    await screen.findByTestId("preview-region");

    const summary = screen.getByTestId("preview-summary");
    expect(summary.textContent).toContain(BRIEF);
    expect(screen.queryByTestId("preview-input")).toBeNull();

    fireEvent.click(screen.getByTestId("preview-back"));
    expect(screen.queryByTestId("preview-summary")).toBeNull();
    const input = screen.getByTestId("preview-input") as HTMLTextAreaElement;
    expect(input.value).toBe(BRIEF);
    expect(screen.queryByTestId("preview-region")).toBeNull();
  });

  it("shows nothing after a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    render(<PreviewBox />);
    fillBrief();
    await generate();

    // A rejected fetch must not crash the page and must not leak the thrown
    // message; it degrades to the generic failure copy.
    const alert = await screen.findByTestId("preview-error");
    expect(alert.textContent).toContain("Couldn't generate that right now");
    expect(alert.textContent).not.toContain("network down");
    expect(screen.queryByTestId("preview-region")).toBeNull();
    expect(screen.getByTestId("preview-input")).not.toBeNull();
  });
});