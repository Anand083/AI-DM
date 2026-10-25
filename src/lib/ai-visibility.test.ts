import { describe, expect, it } from "vitest";
import {
  competitorsMentioned,
  lostMentions,
  sortByEngine,
  summarizeChecks,
  type CheckFacts,
} from "./ai-visibility";

describe("competitorsMentioned", () => {
  const rivals = ["northwind.com", "acme-co.org", "ab.io", "contoso.example"];

  it("finds rivals in the text, ignoring case, spaces and dashes", () => {
    const answer = {
      answerSnippet: "Popular options include NORTHWIND and Acme Co.",
      citedUrls: [],
    };
    expect(competitorsMentioned(answer, rivals)).toEqual(["northwind.com", "acme-co.org"]);
  });

  it("finds rivals in the cited links, even with www", () => {
    const answer = {
      answerSnippet: "No names here.",
      citedUrls: ["https://www.ab.io/page", "not a url"],
    };
    expect(competitorsMentioned(answer, rivals)).toEqual(["ab.io"]);
  });

  it("ignores very short names in the text", () => {
    expect(competitorsMentioned({ answerSnippet: "ab is great", citedUrls: [] }, rivals)).toEqual(
      [],
    );
  });
});

const check = (over: Partial<CheckFacts> = {}): CheckFacts => ({
  engine: "chatgpt",
  brandMentioned: false,
  domainCited: false,
  mentionPosition: null,
  competitorsMentioned: [],
  ...over,
});

describe("summarizeChecks", () => {
  it("is all zero for no checks", () => {
    expect(summarizeChecks([])).toMatchObject({
      total: 0,
      mentionRate: 0,
      citedRate: 0,
      averagePosition: null,
      shareOfVoice: null,
    });
  });

  it("works out the rates, average place, engines and share of voice", () => {
    const summary = summarizeChecks([
      check({
        brandMentioned: true,
        domainCited: true,
        mentionPosition: 1,
        competitorsMentioned: ["a.com"],
      }),
      check({ brandMentioned: true, mentionPosition: 3, engine: "gemini" }),
      check({ competitorsMentioned: ["a.com", "b.com"], engine: "gemini" }),
      check(),
    ]);
    expect(summary).toMatchObject({
      total: 4,
      mentioned: 2,
      mentionRate: 50,
      cited: 1,
      citedRate: 25,
      averagePosition: 2,
      // 2 brand mentions against 3 rival mentions
      shareOfVoice: 40,
      competitorMentions: { "a.com": 2, "b.com": 1 },
    });
    expect(summary.byEngine).toEqual({
      chatgpt: { total: 2, mentioned: 1, mentionRate: 50 },
      gemini: { total: 2, mentioned: 1, mentionRate: 50 },
    });
  });
});

describe("lostMentions", () => {
  it("lists pairs that were mentioned and now are not", () => {
    const before = [
      { promptId: "p1", engine: "chatgpt", brandMentioned: true },
      { promptId: "p1", engine: "gemini", brandMentioned: true },
      { promptId: "p2", engine: "chatgpt", brandMentioned: false },
    ];
    const now = [
      { promptId: "p1", engine: "chatgpt", brandMentioned: false },
      { promptId: "p1", engine: "gemini", brandMentioned: true },
      { promptId: "p2", engine: "chatgpt", brandMentioned: false },
      { promptId: "p3", engine: "chatgpt", brandMentioned: false },
    ];
    expect(lostMentions(before, now)).toEqual([{ promptId: "p1", engine: "chatgpt" }]);
  });
});

describe("sortByEngine", () => {
  it("uses the order of the engine list and puts unknown engines last", () => {
    const sorted = sortByEngine([
      ["perplexity", 1],
      ["zeta", 2],
      ["chatgpt", 3],
      ["claude", 4],
    ]);
    expect(sorted.map(([key]) => key)).toEqual(["chatgpt", "perplexity", "claude", "zeta"]);
  });
});
