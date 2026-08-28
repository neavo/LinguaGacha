import { describe, expect, it } from "vitest";
import { normalize_text_line_breaks, split_text_lines } from "./text-lines";

describe("text line normalization", () => {
  it("normalizes CRLF and CR without dropping empty lines", () => {
    expect(normalize_text_line_breaks("a\r\nb\rc")).toBe("a\nb\nc");
    expect(split_text_lines("a\r\n\r\nb\n")).toEqual(["a", "", "b", ""]);
  });
});
