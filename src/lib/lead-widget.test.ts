import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { embedCode, embedScript, SLUG_PATTERN, topIssues } from "./lead-widget";

const info = {
  missing_title: { title: "Missing title", severity: "CRITICAL", fix: "Add a title." },
  slow: { title: "Slow page", severity: "WARNING", fix: "Speed it up." },
  long_title: { title: "Long title", severity: "NOTICE", fix: "Shorten it." },
  broken: { title: "Broken link", severity: "CRITICAL", fix: "Fix the link." },
} as const;
const lookup = (code: string) => info[code as keyof typeof info];

describe("topIssues", () => {
  it("groups by type, puts serious ones first and counts pages", () => {
    const found = [
      { code: "slow" },
      { code: "slow" },
      { code: "missing_title" },
      { code: "long_title" },
      { code: "long_title" },
      { code: "long_title" },
      { code: "broken" },
      { code: "broken" },
    ];
    expect(topIssues(found, lookup).map((i) => [i.code, i.pages])).toEqual([
      ["broken", 2],
      ["missing_title", 1],
      ["slow", 2],
      ["long_title", 3],
    ]);
  });

  it("respects the limit and copes with no issues", () => {
    expect(topIssues([{ code: "slow" }, { code: "broken" }], lookup, 1)).toHaveLength(1);
    expect(topIssues([], lookup)).toEqual([]);
  });
});

describe("embed code", () => {
  it("builds the tag with the address without a trailing slash", () => {
    expect(embedCode("https://app.example.com/", "bright-studio")).toBe(
      '<script src="https://app.example.com/widget/embed.js" data-agency="bright-studio" async></script>',
    );
  });

  it("the slug pattern accepts agency slugs and refuses anything that could break out", () => {
    for (const ok of ["bright-studio", "a", "a1-b2"]) expect(SLUG_PATTERN.test(ok)).toBe(true);
    for (const bad of ["", "-a", "A", "a b", 'a"><script>', "a/b", "x".repeat(61)])
      expect(SLUG_PATTERN.test(bad)).toBe(false);
  });
});

/** Runs the embed script against a tiny pretend page. */
function run(attributes: Record<string, string>, src = "https://app.example.com/widget/embed.js") {
  const frames: {
    src: string;
    title: string;
    style: { cssText: string; height?: string };
    contentWindow: object;
  }[] = [];
  const inserted: unknown[] = [];
  const listeners: ((event: unknown) => void)[] = [];
  const script = {
    src,
    getAttribute: (name: string) => attributes[name] ?? null,
    parentNode: { insertBefore: (node: unknown) => inserted.push(node) },
  };
  const document = {
    currentScript: script,
    createElement: () => {
      const frame = {
        src: "",
        title: "",
        style: { cssText: "" } as { cssText: string; height?: string },
        contentWindow: {},
      };
      frames.push(frame);
      return frame;
    },
  };
  const window = {
    addEventListener: (_: string, fn: (event: unknown) => void) => listeners.push(fn),
  };
  vm.runInNewContext(embedScript(), { document, window, URL, encodeURIComponent, Math });
  return { frames, inserted, listeners };
}

describe("embed script", () => {
  it("puts the widget page of the agency in a frame, using the address it was loaded from", () => {
    const { frames, inserted } = run({ "data-agency": "bright-studio" });
    expect(frames).toHaveLength(1);
    expect(frames[0]!.src).toBe("https://app.example.com/widget/bright-studio");
    expect(frames[0]!.title).toBe("Free website check");
    expect(inserted).toEqual([frames[0]]);
  });

  it("does nothing without a good agency name", () => {
    for (const slug of [undefined, "", "Bad Name", '"><img src=x>']) {
      const { frames } = run(slug === undefined ? {} : { "data-agency": slug });
      expect(frames).toHaveLength(0);
    }
  });

  it("resizes only for height messages from its own frame and address, within limits", () => {
    const { frames, listeners } = run({ "data-agency": "bright-studio" });
    const frame = frames[0]!;
    const send = (
      data: unknown,
      origin = "https://app.example.com",
      source: object = frame.contentWindow,
    ) => listeners[0]!({ data, origin, source });
    send({ type: "lead-widget-height", height: 640 });
    expect(frame.style.height).toBe("640px");
    send({ type: "lead-widget-height", height: 99999 });
    expect(frame.style.height).toBe("2000px");
    send({ type: "lead-widget-height", height: 5 });
    expect(frame.style.height).toBe("200px");
    send({ type: "lead-widget-height", height: 777 }, "https://evil.example");
    send({ type: "lead-widget-height", height: 888 }, "https://app.example.com", {});
    send({ type: "other", height: 999 });
    send({ type: "lead-widget-height", height: "999" });
    expect(frame.style.height).toBe("200px");
  });
});
