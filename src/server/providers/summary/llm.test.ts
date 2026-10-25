import { describe, expect, it, vi } from "vitest";
import { assembleReport } from "@/lib/report-assembler";
import type { ReportInput } from "@/lib/report-model";
import { LlmError, type LlmClient, type LlmRequest } from "../llm/types";
import { cleanModelText, LlmSummaryProvider, summaryFacts } from "./llm";
import { buildSummary } from "./mock";

const input: ReportInput = {
  title: "Report",
  projectName: "Shop",
  clientName: "Blue Bakery",
  domain: "bluebakery.com",
  period: { start: "2026-03-01", end: "2026-03-30", label: "1 Mar 2026 to 30 Mar 2026" },
  sections: ["summary"],
  notes: null,
  keywords: [
    { phrase: "bread", position: 4, startPosition: 12, change: 8, url: null, checked: true },
    { phrase: "cakes", position: 15, startPosition: 9, change: -6, url: null, checked: true },
  ],
  audit: null,
  generatedOn: "2026-03-31",
};
const model = assembleReport(input);

function fakeClient(answer: string | LlmError) {
  const requests: LlmRequest[] = [];
  const client: LlmClient = {
    name: "fake",
    model: "fake/model",
    complete: async (r) => {
      requests.push(r);
      if (answer instanceof LlmError) throw answer;
      return { text: answer, inputTokens: null, outputTokens: null, model: "fake/model" };
    },
  };
  return { client, requests };
}

describe("cleanModelText", () => {
  it("removes long dashes and markdown and squeezes spaces", () => {
    expect(cleanModelText("**Great**   month — rankings\n\nup – nice.", 500)).toBe(
      "Great month , rankings up , nice.",
    );
  });
  it("cuts a long answer at a sentence end", () => {
    const text = `${"One sentence here. ".repeat(10)}`;
    const cut = cleanModelText(text, 60);
    expect(cut.length).toBeLessThanOrEqual(60);
    expect(cut.endsWith(".")).toBe(true);
  });
});

describe("LlmSummaryProvider", () => {
  it("sends numbers only, with rules that keep the platform and the AI out of the text", async () => {
    const { client, requests } = fakeClient("A good month. Bread rose to position 4.");
    const text = await new LlmSummaryProvider(client).write(model);
    expect(text).toBe("A good month. Bread rose to position 4.");
    const [req] = requests;
    expect(req!.system).toContain("Never invent a number");
    expect(req!.system).toContain("Do not mention any software");
    expect(req!.maxTokens).toBeLessThanOrEqual(400);
    expect(req!.user).toBe(summaryFacts(model));
    expect(req!.user).toContain("Website: bluebakery.com");
    expect(req!.user).toContain('Biggest gain: "bread"');
    // The client's name and other free text are not sent.
    expect(req!.user).not.toContain("Blue Bakery");
  });

  it("falls back to the fixed sentences when the model cannot answer", async () => {
    const onFallback = vi.fn();
    const { client } = fakeClient(new LlmError("busy", true, 429));
    const text = await new LlmSummaryProvider(client, onFallback).write(model);
    expect(text).toBe(buildSummary(model));
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it("does not hide mistakes that are not model failures", async () => {
    const client: LlmClient = {
      name: "x",
      model: "x",
      complete: async () => {
        throw new TypeError("bug");
      },
    };
    await expect(new LlmSummaryProvider(client).write(model)).rejects.toThrow("bug");
  });

  it("writes a review reply from the stars and the text, and falls back the same way", async () => {
    const { client, requests } = fakeClient("Thank you, Sam! We are glad you enjoyed it.");
    const provider = new LlmSummaryProvider(client);
    const reply = await provider.suggestReply({
      businessName: "Blue Bakery",
      reviewerName: "Sam Jones",
      rating: 5,
      text: "Lovely bread.",
    });
    expect(reply).toContain("Thank you, Sam");
    expect(requests[0]!.user).toContain("Reviewer first name: Sam");
    expect(requests[0]!.user).not.toContain("Jones");
    expect(requests[0]!.user).toContain("Stars: 5 of 5");

    const failing = new LlmSummaryProvider(fakeClient(new LlmError("down", true)).client);
    expect(
      await failing.suggestReply({
        businessName: "Blue Bakery",
        reviewerName: "Sam",
        rating: 1,
        text: "Bad",
      }),
    ).toContain("we are sorry");
  });
});
