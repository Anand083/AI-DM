import { describe, expect, it } from "vitest";
import { parseClientCsv } from "./client-import";

describe("parseClientCsv", () => {
  it("reads named columns in any order", () => {
    const { rows, problems } = parseClientCsv(
      "domain,client,project\nacme.com,Acme,Main site\n,Beta,\n",
    );
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Acme", domain: "acme.com", projectName: "Main site" });
    expect(rows[1]).toMatchObject({ name: "Beta", domain: "" });
  });
  it("uses the default order without a header", () => {
    const { rows } = parseClientCsv("Acme,acme.com,Ann,ann@acme.com,Site,acme.com");
    expect(rows[0]).toMatchObject({
      name: "Acme",
      website: "acme.com",
      contactName: "Ann",
      contactEmail: "ann@acme.com",
      projectName: "Site",
      domain: "acme.com",
    });
  });
  it("reports lines without a client name", () => {
    const { rows, problems } = parseClientCsv("client,website\n,x.com\nOk,ok.com");
    expect(rows).toHaveLength(1);
    expect(problems).toEqual([{ line: 2, message: "No client name on this line." }]);
  });
  it("protects against formula cells and limits rows", () => {
    const many = ["client", ...Array.from({ length: 250 }, (_, i) => `C${i}`)].join("\n");
    const out = parseClientCsv(many);
    expect(out.rows).toHaveLength(200);
    expect(out.truncated).toBe(true);
    expect(parseClientCsv("client\n'=SUM(A1)").rows[0]!.name).toBe("=SUM(A1)");
  });
  it("handles empty text", () => {
    expect(parseClientCsv("").rows).toEqual([]);
  });
});
