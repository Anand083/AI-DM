import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { OpenRouterClient } from "./openrouter";
import { LlmError } from "./types";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const URL = "https://openrouter.ai/api/v1/chat/completions";
const client = new OpenRouterClient({ apiKey: "key-123", model: "vendor/model-a" });
const ask = () => client.complete({ system: "Be brief.", user: "Hello", maxTokens: 50 });

describe("OpenRouterClient", () => {
  it("sends the key, the model, the limits and both messages, and reads the answer", async () => {
    let headers: Headers | undefined;
    let body: Record<string, unknown> = {};
    server.use(
      http.post(URL, async ({ request }) => {
        headers = request.headers;
        body = (await request.json()) as typeof body;
        return HttpResponse.json({
          model: "vendor/model-a",
          choices: [{ message: { content: "  Hi there.  " } }],
          usage: { prompt_tokens: 12, completion_tokens: 3 },
        });
      }),
    );
    const result = await ask();
    expect(result).toEqual({
      text: "Hi there.",
      inputTokens: 12,
      outputTokens: 3,
      model: "vendor/model-a",
    });
    expect(headers?.get("authorization")).toBe("Bearer key-123");
    expect(body).toMatchObject({
      model: "vendor/model-a",
      max_tokens: 50,
      reasoning: { enabled: false },
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hello" },
      ],
    });
  });

  it("turns each failure into a plain LlmError and says whether retrying can help", async () => {
    const cases: [number, RegExp, boolean][] = [
      [401, /refused the key/, false],
      [402, /no credit/, false],
      [429, /busy/, true],
      [503, /busy/, true],
      [400, /refused the request \(400\)/, false],
    ];
    for (const [status, message, retryable] of cases) {
      server.use(http.post(URL, () => new HttpResponse(null, { status })));
      const error = await ask().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LlmError);
      expect((error as LlmError).message).toMatch(message);
      expect((error as LlmError).retryable).toBe(retryable);
    }
  });

  it("treats an empty answer, bad JSON and a dropped connection as errors", async () => {
    server.use(
      http.post(URL, () => HttpResponse.json({ choices: [{ message: { content: "  " } }] })),
    );
    await expect(ask()).rejects.toThrow(/empty answer/);
    server.use(http.post(URL, () => new HttpResponse("not json", { status: 200 })));
    await expect(ask()).rejects.toThrow(/empty answer/);
    server.use(http.post(URL, () => HttpResponse.error()));
    await expect(ask()).rejects.toMatchObject({ retryable: true, message: /could not be reached/ });
  });

  it("gives up after the timeout", async () => {
    const slow = new OpenRouterClient({ apiKey: "k", model: "m", timeoutMs: 50 });
    server.use(
      http.post(URL, async () => {
        await new Promise((r) => setTimeout(r, 400));
        return HttpResponse.json({ choices: [{ message: { content: "late" } }] });
      }),
    );
    await expect(slow.complete({ system: "s", user: "u", maxTokens: 5 })).rejects.toMatchObject({
      retryable: true,
      message: /took too long/,
    });
  });
});
