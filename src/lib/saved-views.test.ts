import { describe, expect, it } from "vitest";
import { cleanSearchText, cleanViewParams, viewHref } from "./saved-views";

describe("saved views", () => {
  it("keeps only allowed keys and short values", () => {
    expect(cleanViewParams("tasks", { view: "mine", q: " seo ", evil: "x", page: "3" })).toEqual({
      view: "mine",
      q: "seo",
    });
    expect(cleanViewParams("clients", { status: "", q: "a".repeat(300) }).q).toHaveLength(100);
    expect(cleanViewParams("clients", null)).toEqual({});
    expect(cleanViewParams("clients", { q: 5 })).toEqual({});
  });
  it("builds addresses", () => {
    expect(viewHref("/app/x/tasks", {})).toBe("/app/x/tasks");
    expect(viewHref("/app/x/tasks", { view: "mine", q: "a b" })).toBe(
      "/app/x/tasks?view=mine&q=a+b",
    );
  });
  it("cleans search text", () => {
    expect(cleanSearchText("  acme   dental ")).toBe("acme dental");
    expect(cleanSearchText("a")).toBeNull();
    expect(cleanSearchText(undefined)).toBeNull();
  });
});
