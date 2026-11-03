import { expect, it } from "vitest";
import { parsePageUpdate } from "./page-updates";

const value = {
  file_path: "sample.pdf",
  page: 1,
  fp: "abcd",
  translation: { kind: "translate", markdown: "完整译稿" },
  reviewed: false,
  notes: "",
};

it("页面解析保留完整载荷和物理行号", () => {
  expect(parsePageUpdate({ line: 3, value })).toEqual({ intent: { ...value, line: 3 } });
});

it.each([
  { ...value, page: "1" },
  { ...value, extra: true },
])("整行校验在页面投影前拒绝非法载荷 %j", (input) => {
  expect(parsePageUpdate({ line: 7, value: input })).toMatchObject({
    rejection: { scope: "pages", reason: "invalid_change", line: 7 },
  });
});

it("JSON 读取错误保留原始行号和原因", () => {
  expect(parsePageUpdate({ line: 5, value: {}, error: "Invalid JSON" })).toMatchObject({
    rejection: { line: 5, path: "/", message: "Invalid JSON" },
  });
});
