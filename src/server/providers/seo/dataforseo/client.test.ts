import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { FeatureUnavailableError, ProviderError } from "../errors";
import { callbackFields } from "./callbacks";
import { assertTaskOk, DataForSeoClient, errorForStatus } from "./client";
import { DataForSeoProvider } from "./index";

const BASE = "https://sandbox.dataforseo.test";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ok = (extra: object = {}) => ({
  status_code: 20000,
  status_message: "Ok.",
  cost: 0.0006,
  tasks_count: 1,
  tasks: [{ id: "task-1", status_code: 20000, status_message: "Ok.", result: [] }],
  ...extra,
});

function makeClient(overrides: Partial<ConstructorParameters<typeof DataForSeoClient>[0]> = {}) {
  const sleeps: number[] = [];
  const logs: unknown[] = [];
  const client = new DataForSeoClient({
    login: "me@example.test",
    password: "s3cret-p4ss",
    baseUrl: BASE,
    sleep: async (ms) => void sleeps.push(ms),
    logger: { info: (o, m) => logs.push({ ...o, m }), warn: (o, m) => logs.push({ ...o, m }) },
    ...overrides,
  });
  return { client, sleeps, logs };
}

describe("requests", () => {
  it("signs in with Basic auth and asks for JSON", async () => {
    let seen: Request | undefined;
    server.use(
      http.get(`${BASE}/v3/appendix/user_data`, ({ request }) => {
        seen = request;
        return HttpResponse.json(ok());
      }),
    );
    await makeClient().client.get("/v3/appendix/user_data");
    const expected = `Basic ${Buffer.from("me@example.test:s3cret-p4ss").toString("base64")}`;
    expect(seen!.headers.get("authorization")).toBe(expected);
    expect(seen!.headers.get("accept")).toBe("application/json");
  });

  it("posts JSON bodies", async () => {
    let body: unknown;
    let type: string | null = null;
    server.use(
      http.post(`${BASE}/v3/x`, async ({ request }) => {
        body = await request.json();
        type = request.headers.get("content-type");
        return HttpResponse.json(ok());
      }),
    );
    await makeClient().client.post("/v3/x", [{ keyword: "seo" }]);
    expect(body).toEqual([{ keyword: "seo" }]);
    expect(type).toBe("application/json");
  });

  it("tolerates a trailing slash in the base URL", async () => {
    server.use(http.get(`${BASE}/v3/ping`, () => HttpResponse.json(ok())));
    await expect(makeClient({ baseUrl: `${BASE}/` }).client.get("/v3/ping")).resolves.toBeTruthy();
  });

  it("never logs the login or password", async () => {
    server.use(http.get(`${BASE}/v3/ping`, () => HttpResponse.json(ok())));
    server.use(http.get(`${BASE}/v3/bad`, () => new HttpResponse(null, { status: 500 })));
    const { client, logs } = makeClient({ maxRetries: 1 });
    await client.get("/v3/ping");
    await client.get("/v3/bad").catch(() => {});
    const text = JSON.stringify(logs);
    expect(text).not.toContain("s3cret-p4ss");
    expect(text).not.toContain("me@example.test");
    expect(text).not.toContain(Buffer.from("me@example.test:s3cret-p4ss").toString("base64"));
    expect(text).toContain("/v3/ping");
  });
});

describe("cost and tasks", () => {
  it("reads the cost in micro-dollars and the task ids", async () => {
    server.use(http.get(`${BASE}/v3/ping`, () => HttpResponse.json(ok({ cost: 0.00123 }))));
    const { client, logs } = makeClient();
    const result = await client.get("/v3/ping");
    expect(result.costMicros).toBe(1230);
    expect(result.tasks.map((t) => t.id)).toEqual(["task-1"]);
    expect(logs[0]).toMatchObject({ path: "/v3/ping", costMicros: 1230, taskIds: ["task-1"] });
  });

  it("treats a missing cost as 0", async () => {
    server.use(
      http.get(`${BASE}/v3/ping`, () =>
        HttpResponse.json({ status_code: 20000, status_message: "Ok." }),
      ),
    );
    expect((await makeClient().client.get("/v3/ping")).costMicros).toBe(0);
  });
});

describe("retries", () => {
  it("retries HTTP 429 with growing waits and then succeeds", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v3/ping`, () => {
        calls++;
        return calls < 3 ? new HttpResponse(null, { status: 429 }) : HttpResponse.json(ok());
      }),
    );
    const { client, sleeps } = makeClient();
    await client.get("/v3/ping");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("retries HTTP 5xx and gives up after 3 retries with a retryable error", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v3/ping`, () => {
        calls++;
        return new HttpResponse(null, { status: 503 });
      }),
    );
    const { client, sleeps } = makeClient();
    const error = await client.get("/v3/ping").catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.retryable).toBe(true);
    expect(calls).toBe(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("retries network errors", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v3/ping`, () => {
        calls++;
        return calls === 1 ? HttpResponse.error() : HttpResponse.json(ok());
      }),
    );
    await makeClient().client.get("/v3/ping");
    expect(calls).toBe(2);
  });

  it("times out slow answers and retries", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v3/slow`, async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 300));
        return HttpResponse.json(ok());
      }),
    );
    const error = await makeClient({ timeoutMs: 50, maxRetries: 1 })
      .client.get("/v3/slow")
      .catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe("NETWORK");
    expect(calls).toBe(2);
  });

  it("does not retry a rejected login (HTTP 401)", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v3/ping`, () => {
        calls++;
        return new HttpResponse(null, { status: 401 });
      }),
    );
    const error = await makeClient()
      .client.get("/v3/ping")
      .catch((e) => e);
    expect(error).toMatchObject({ code: "AUTH", retryable: false });
    expect(calls).toBe(1);
  });
});

describe("status codes inside the body", () => {
  const withCode = (code: number, message: string) =>
    http.get(`${BASE}/v3/ping`, () =>
      HttpResponse.json({ status_code: code, status_message: message }),
    );

  it.each([
    [40101, "AUTH", false],
    [40200, "NO_FUNDS", false],
    [40400, "NOT_FOUND", false],
    [40501, "BAD_REQUEST", false],
  ])("maps %i to %s (retryable: %s) without retrying", async (code, errorCode, retryable) => {
    server.use(withCode(code, "Something"));
    const { client, sleeps } = makeClient();
    const error = await client.get("/v3/ping").catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: errorCode, retryable });
    expect(error.message).toContain(String(code));
    expect(sleeps).toEqual([]);
  });

  it("retries a rate limit (40202) and a server error (50000) found in the body", async () => {
    for (const code of [40202, 50000]) {
      server.use(withCode(code, "Busy"));
      const { client, sleeps } = makeClient({ maxRetries: 2 });
      const error = await client.get("/v3/ping").catch((e) => e);
      expect(error.retryable).toBe(true);
      expect(sleeps).toEqual([1000, 2000]);
    }
  });

  it("treats 20xxx codes as OK, including 'task created' (20100)", () => {
    expect(errorForStatus(20000, "Ok.")).toBeNull();
    expect(errorForStatus(20100, "Task Created.")).toBeNull();
  });

  it("assertTaskOk throws for a failed task", () => {
    expect(() =>
      assertTaskOk({ id: "t", status_code: 40501, status_message: "Invalid field" }),
    ).toThrow(/40501/);
    expect(() =>
      assertTaskOk({ id: "t", status_code: 20000, status_message: "Ok." }),
    ).not.toThrow();
  });
});

describe("DataForSeoProvider.testConnection", () => {
  const provider = (client = makeClient().client) =>
    new DataForSeoProvider({ login: "a", password: "b", baseUrl: BASE, client });

  it("returns the account balance", async () => {
    server.use(
      http.get(`${BASE}/v3/appendix/user_data`, () =>
        HttpResponse.json(
          ok({
            tasks: [
              {
                id: "t",
                status_code: 20000,
                status_message: "Ok.",
                result: [{ login: "me@example.test", money: { balance: 41.5 } }],
              },
            ],
          }),
        ),
      ),
    );
    expect(await provider().testConnection()).toMatchObject({ ok: true, balanceUsd: 41.5 });
  });

  it("returns ok: false with a message instead of throwing", async () => {
    server.use(
      http.get(`${BASE}/v3/appendix/user_data`, () => new HttpResponse(null, { status: 401 })),
    );
    const result = await provider().testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/login or password/);
  });

  it("lists ready task ids for operations that support it, and nothing for others", async () => {
    server.use(
      http.get(`${BASE}/v3/serp/google/organic/tasks_ready`, () =>
        HttpResponse.json(
          ok({
            tasks: [
              {
                id: "x",
                status_code: 20000,
                status_message: "Ok.",
                result: [{ id: "a1", tag: "t1" }, { id: "a2" }],
              },
            ],
          }),
        ),
      ),
    );
    const p = provider();
    expect(await p.listReadyTaskIds("rankings")).toEqual(["a1", "a2"]);
    expect(await p.listReadyTaskIds("audit")).toEqual([]);
  });

  it("says so plainly for features DataForSEO does not cover yet", () => {
    expect(() => provider().getReviews({} as never)).toThrow(/not available with DataForSEO/i);
    expect(() => provider().checkAiVisibility({} as never)).toThrow(FeatureUnavailableError);
  });
});

describe("callbackFields", () => {
  it("adds nothing in poll mode", () => {
    expect(callbackFields("poll", "https://app.test", "s")).toEqual({});
  });
  it("builds the pingback URL with DataForSEO's $id and $tag placeholders", () => {
    expect(callbackFields("pingback", "https://app.test/", "a b&c")).toEqual({
      pingback_url:
        "https://app.test/api/providers/dataforseo/pingback?id=$id&tag=$tag&secret=a%20b%26c",
    });
  });
  it("builds the postback URL", () => {
    expect(callbackFields("postback", "https://app.test", "s")).toEqual({
      postback_url: "https://app.test/api/providers/dataforseo/postback?secret=s",
      postback_data: "advanced",
    });
  });
});
