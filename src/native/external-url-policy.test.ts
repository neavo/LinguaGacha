import { describe, expect, it } from "vitest";

import { resolve_external_url } from "./external-url-policy";

describe("外链策略", () => {
  it("只允许 http 和 https 外链交给系统浏览器", () => {
    expect(resolve_external_url(" https://example.com/docs ")).toBe("https://example.com/docs");
    expect(resolve_external_url("http://example.com")).toBe("http://example.com/");
  });

  it("拒绝空链接和本地协议", () => {
    expect(() => resolve_external_url("")).toThrow("External URL must not be empty.");
    expect(() => resolve_external_url("file:///tmp/demo.txt")).toThrow(
      "Only http and https URLs can be opened in the system browser.",
    );
  });
});
