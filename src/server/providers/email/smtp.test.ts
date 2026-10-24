import { describe, expect, it } from "vitest";
import { parseFrom } from "./smtp";

describe("parseFrom", () => {
  it("splits name and address", () => {
    expect(parseFrom('"SEO Platform" <no-reply@localhost>')).toEqual({
      name: "SEO Platform",
      address: "no-reply@localhost",
    });
    expect(parseFrom("SEO Platform <no-reply@localhost>")).toEqual({
      name: "SEO Platform",
      address: "no-reply@localhost",
    });
  });
  it("accepts a bare address", () => {
    expect(parseFrom("a@b.test")).toEqual({ address: "a@b.test" });
  });
});
