import type { ReportAiInput } from "./report-model";

/** The lines of the AI visibility section as plain text, for the web view and the PDF. */
export function describeAi(a: ReportAiInput): string[] {
  const change =
    a.previousRate === null
      ? ""
      : a.mentionRate === a.previousRate
        ? " This is the same as the check before."
        : ` This is ${a.mentionRate > a.previousRate ? "up" : "down"} ${Math.abs(a.mentionRate - a.previousRate)} points from the check before.`;
  const lines = [
    `On ${a.checkedOn}, AI assistants named the brand in ${a.mentionRate}% of ${a.total} answers.${change}`,
    `The website was linked in ${a.citedRate}% of the answers.`,
  ];
  if (a.shareOfVoice !== null) {
    lines.push(
      `Against the competitors named in the same answers, the brand has a ${a.shareOfVoice}% share of voice.`,
    );
  }
  return lines;
}
