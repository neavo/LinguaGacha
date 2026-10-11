import { expect, it } from "vitest";
import type { JsonValue } from "../../../domain/json";
import { read_rgss_metadata } from "./item";
const metadata = (span: JsonValue) => ({
  rpgmaker_rgss: {
    internal_file_path: "Data/Scripts.rvdata2",
    usage: "text",
    location: { kind: "ruby", container: { kind: "archive", path: [0, 2] }, span },
  },
});
it("Ruby 元数据只接受原稿字节范围", () => {
  expect(read_rgss_metadata(metadata({ start: 5, end: 12 }))).toMatchObject({
    location: { span: { start: 5, end: 12 } },
  });
  expect(() =>
    read_rgss_metadata(metadata({ start: 5, end: 12, mode: "literal", opening: '"' })),
  ).toThrow("Invalid Ruby byte range");
  expect(() => read_rgss_metadata(metadata({ start: 12, end: 5 }))).toThrow(
    "Invalid Ruby byte range",
  );
});
it("无效成员类型不能穿过定位读取边界", () => {
  expect(() =>
    read_rgss_metadata({
      rpgmaker_rgss: {
        internal_file_path: "Data/Actors.rvdata2",
        usage: "text",
        location: { kind: "field", path: [1, { entry: -1 }] },
      },
    }),
  ).toThrow("Invalid RGSS member");
});
