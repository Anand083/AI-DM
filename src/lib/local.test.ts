import { describe, expect, it } from "vitest";
import {
  compareListing,
  consistencyScore,
  normalizeAddress,
  normalizeName,
  normalizePhone,
  pseudoLocationCode,
} from "./local";

const nap = {
  name: "Acme Dental, LLC",
  address: "12 North Main Street, Suite 4",
  phone: "+1 (512) 555-0134",
};

describe("normalizing", () => {
  it("ignores case, punctuation and company endings in names", () => {
    expect(normalizeName("ACME dental Inc.")).toBe("acme dental");
    expect(normalizeName("Smith & Sons Ltd")).toBe("smith and sons");
  });
  it("treats street/st, suite/ste and directions the same", () => {
    expect(normalizeAddress("12 North Main Street, Suite 4")).toBe("12 n main st ste 4");
    expect(normalizeAddress("12 N. Main St., Ste 4")).toBe("12 n main st ste 4");
  });
  it("compares phone numbers by their last 10 digits", () => {
    expect(normalizePhone("+1 (512) 555-0134")).toBe("5125550134");
    expect(normalizePhone("512.555.0134")).toBe("5125550134");
    expect(normalizePhone("")).toBe("");
  });
});

describe("compareListing", () => {
  it("matches the same details written differently", () => {
    expect(
      compareListing(nap, {
        found: true,
        name: "Acme Dental",
        address: "12 N. Main St., Ste 4",
        phone: "512-555-0134",
      }),
    ).toEqual({ status: "match", wrong: [] });
  });
  it("lists what is wrong", () => {
    expect(
      compareListing(nap, {
        found: true,
        name: "Acme Dentistry",
        address: "12 N. Main St., Ste 4",
        phone: "512-555-9999",
      }),
    ).toEqual({ status: "differs", wrong: ["name", "phone"] });
    expect(
      compareListing(nap, { found: true, name: null, address: null, phone: null }).wrong,
    ).toEqual(["name", "address", "phone"]);
  });
  it("says missing when there is no listing", () => {
    expect(compareListing(nap, { found: false, name: null, address: null, phone: null })).toEqual({
      status: "missing",
      wrong: [],
    });
  });
});

describe("consistencyScore", () => {
  it("counts matches among the listings that exist", () => {
    const match = { status: "match", wrong: [] } as const;
    const differs = { status: "differs", wrong: ["phone"] } as const;
    const missing = { status: "missing", wrong: [] } as const;
    expect(consistencyScore([match, match, differs, missing])).toBe(67);
    expect(consistencyScore([missing, missing])).toBeNull();
    expect(consistencyScore([])).toBeNull();
    expect(consistencyScore([match])).toBe(100);
  });
});

describe("pseudoLocationCode", () => {
  it("is stable, ignores case and punctuation, and differs between cities", () => {
    expect(pseudoLocationCode("Austin, TX")).toBe(pseudoLocationCode("austin tx"));
    expect(pseudoLocationCode("Austin")).not.toBe(pseudoLocationCode("Dallas"));
    expect(pseudoLocationCode("Austin")).toBeGreaterThanOrEqual(910_000);
  });
});
