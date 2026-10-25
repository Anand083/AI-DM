import { describe, expect, it } from "vitest";
import {
  buildJsonPayload,
  buildSlackPayload,
  checkWebhookUrl,
  isPrivateIp,
  signWebhook,
} from "./webhook";

describe("isPrivateIp", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ])("%s is private", (ip) => expect(isPrivateIp(ip)).toBe(true));
  it.each(["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700::1111"])("%s is public", (ip) =>
    expect(isPrivateIp(ip)).toBe(false),
  );
});

describe("checkWebhookUrl", () => {
  it("accepts a normal https address", () => {
    expect(checkWebhookUrl("https://hooks.example.com/a?b=1")).toEqual({
      ok: true,
      url: "https://hooks.example.com/a?b=1",
    });
  });
  it.each([
    ["not a url"],
    ["http://example.com/hook"],
    ["https://localhost/hook"],
    ["https://127.0.0.1/hook"],
    ["https://169.254.169.254/latest"],
    ["https://[::1]/x"],
    ["https://intranet/x"],
    ["https://printer.local/x"],
    ["https://user:pw@example.com/x"],
    ["https://example.com:8443/x"],
  ])("rejects %s", (url) => expect(checkWebhookUrl(url).ok).toBe(false));
  it("lets development use local http", () => {
    expect(checkWebhookUrl("http://127.0.0.1:9999/x", { allowLocalHttp: true }).ok).toBe(true);
    expect(checkWebhookUrl("http://10.0.0.1/x", { allowLocalHttp: true }).ok).toBe(false);
  });
});

describe("payloads", () => {
  const alert = {
    id: "a1",
    type: "RANK_DROP",
    severity: "WARNING",
    title: "Drop <b>",
    body: "A & B",
    projectId: "p1",
    createdAt: new Date("2026-03-10T00:00:00Z"),
  };
  it("signs the time and body", () => {
    const a = signWebhook("s", "{}", 100);
    expect(a).toMatch(/^t=100,v1=[0-9a-f]{64}$/);
    expect(signWebhook("s", "{}", 101)).not.toBe(a);
    expect(signWebhook("t", "{}", 100)).not.toBe(a);
  });
  it("builds json", () => {
    const body = JSON.parse(buildJsonPayload("ag1", alert));
    expect(body).toMatchObject({ event: "alert.created", agencyId: "ag1", alert: { id: "a1" } });
  });
  it("escapes slack text", () => {
    expect(buildSlackPayload("Agency", alert)).toContain("Drop &lt;b&gt;");
    expect(buildSlackPayload("Agency", alert)).toContain("A &amp; B");
  });
});
