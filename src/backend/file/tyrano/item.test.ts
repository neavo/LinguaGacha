import { expect, it } from "vitest";
import { read_tyrano_metadata } from "./item";

it("持久化定位保留原值，非法成员、用途和范围在格式边界拒绝", () => {
  const metadata = {
    internal_file_path: "data/scenario/a.ks",
    usage: "parameter",
    location: { kind: "param", start: 2, end: 5 },
  };
  expect(read_tyrano_metadata({ tyrano: metadata })).toEqual(metadata);
  const historical = { ...metadata, line: 1, source_context: "旧工程原稿摘录" };
  expect(read_tyrano_metadata({ tyrano: historical })).toEqual(historical);
  for (const changed of [
    { ...metadata, internal_file_path: "../a.ks" },
    { ...metadata, usage: "unknown" },
    { ...metadata, location: { ...metadata.location, end: 1 } },
  ])
    expect(() => read_tyrano_metadata({ tyrano: changed })).toThrow();
});
