import { describe, it, expect } from "vitest";
import { stripThinkBlocks, ThinkStreamFilter } from "./think-filter.js";

describe("stripThinkBlocks (non-streaming)", () => {
  it("passes plain text through untouched", () => {
    expect(stripThinkBlocks("مرحباً بك في بوت الباز")).toBe("مرحباً بك في بوت الباز");
  });

  it("removes a complete <think> block", () => {
    const input = "<think>Let me calculate: 2+2=4</think>The answer is 4.";
    expect(stripThinkBlocks(input)).toBe("The answer is 4.");
  });

  it("removes a complete <reasoning> block", () => {
    const input = "<reasoning>internal steps here</reasoning>Final: use Short Circuit study.";
    expect(stripThinkBlocks(input)).toBe("Final: use Short Circuit study.");
  });

  it("removes MULTILINE think blocks", () => {
    const input = "<think>\nline1\nline2\nline3\n</think>\n\nAnswer with **steps**.";
    expect(stripThinkBlocks(input)).toBe("Answer with **steps**.");
  });

  it("removes multiple blocks", () => {
    const input = "<think>a</think>Hi <think>b</think>there";
    expect(stripThinkBlocks(input)).toBe("Hi there");
  });

  it("drops unclosed think block entirely (token burn safety)", () => {
    const input = "<think>reasoning that never closed because tokens ran out";
    expect(stripThinkBlocks(input)).toBe("");
  });

  it("is case-insensitive on tags", () => {
    const input = "<THINK>loud</THINK>ok";
    expect(stripThinkBlocks(input)).toBe("ok");
  });

  it("handles adjacent and nested-looking content", () => {
    const input = "<think>a<think>b</think>after";
    // inner <think> is literal text inside the first block → block ends at first close
    expect(stripThinkBlocks(input)).toBe("after");
  });

  it("returns empty for empty input", () => {
    expect(stripThinkBlocks("")).toBe("");
  });
});

describe("ThinkStreamFilter (streaming)", () => {
  function feedAll(filter: ThinkStreamFilter, chunks: string[]): string {
    let out = "";
    for (const c of chunks) out += filter.push(c);
    out += filter.flush();
    return out;
  }

  it("passes plain single-chunk text through", () => {
    const f = new ThinkStreamFilter();
    expect(feedAll(f, ["Hello, how can I help?"])).toBe("Hello, how can I help?");
  });

  it("strips a think block contained in one chunk", () => {
    const f = new ThinkStreamFilter();
    expect(feedAll(f, ["<think>secret</think>Answer"])).toBe("Answer");
  });

  it("strips think block SPLIT ACROSS chunks (tag split mid-way)", () => {
    const f = new ThinkStreamFilter();
    const out = feedAll(f, ["<thi", "nk>hidden rea", "soning</th", "ink>Visible answer"]);
    expect(out).toBe("Visible answer");
  });

  it("never leaks a partial opening tag at chunk boundaries", () => {
    const f = new ThinkStreamFilter();
    // Chunk ends with "<" — must be held back, not emitted
    const part1 = f.push("text before <");
    expect(part1).toBe("text before ");
    const part2 = f.push("think>hidden</think>done");
    const part3 = f.flush();
    expect(part1 + part2 + part3).toBe("text before done");
  });

  it("handles false-alarm angle brackets that are NOT tags", () => {
    const f = new ThinkStreamFilter();
    // "a < b and c > d" — the "<" is held briefly then emitted at flush/end
    const out = feedAll(f, ["if a < b then ", "compare x"]);
    expect(out).toBe("if a < b then compare x");
  });

  it("drops everything if the stream ends inside an unclosed think block", () => {
    const f = new ThinkStreamFilter();
    const out = feedAll(f, ["<think>ran out of tokens mid-reasoning"]);
    expect(out).toBe("");
    expect(f.sawOutput).toBe(false);
  });

  it("tracks sawOutput correctly", () => {
    const f = new ThinkStreamFilter();
    f.push("visible");
    expect(f.sawOutput).toBe(true);
    const g = new ThinkStreamFilter();
    g.push("<think>hidden");
    g.flush();
    expect(g.sawOutput).toBe(false);
  });

  it("strips multiple blocks across many small chunks", () => {
    const f = new ThinkStreamFilter();
    const full = "<think>x</think>A<think>y</think>B<think>z</think>C";
    const chunks = full.split(""); // one char at a time — worst case
    expect(feedAll(f, chunks)).toBe("ABC");
  });

  it("supports <reasoning> tags too, split across chunks", () => {
    const f = new ThinkStreamFilter();
    const out = feedAll(f, ["<rea", "soning>plan</rea", "soning>final text"]);
    expect(out).toBe("final text");
  });

  it("real-world Arabic reasoning leak scenario", () => {
    const f = new ThinkStreamFilter();
    const out = feedAll(f, [
      "<think>\nالمستخدم يسأل عن arc flash، يجب أن أستخدم IEEE 1584\n",
      "</think>",
      "### خطوات الحساب\n1. افتح **ArcSafety**",
    ]);
    expect(out).toBe("### خطوات الحساب\n1. افتح **ArcSafety**");
  });

  it("multiline think block streamed in chunks", () => {
    const f = new ThinkStreamFilter();
    const out = feedAll(f, [
      "<think>\nstep 1\nstep 2\n",
      "step 3\n</thi",
      "nk>\n## Answer\nDo X.",
    ]);
    // the "\n" right after the closing tag is real content and must survive
    expect(out).toBe("\n## Answer\nDo X.");
  });
});
