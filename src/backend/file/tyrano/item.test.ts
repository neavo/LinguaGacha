import { expect, it } from "vitest";
import { read_tyrano_metadata } from "./item";

it("持久化定位保留原值，非法成员、用途和范围在格式边界拒绝", () => {
  const metadata = {
    internal_file_path: "data/scenario/a.ks",
    usage: "parameter",
    location: { kind: "param", start: 2, end: 5 },
    line: 1,
  };
  expect(read_tyrano_metadata({ tyrano: metadata })).toEqual(metadata);
  for (const changed of [
    { ...metadata, internal_file_path: "../a.ks" },
    { ...metadata, usage: "unknown" },
    { ...metadata, location: { ...metadata.location, end: 1 } },
  ])
    expect(() => read_tyrano_metadata({ tyrano: changed })).toThrow();
});
