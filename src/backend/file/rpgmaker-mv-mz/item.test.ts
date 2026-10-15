import { expect, it } from "vitest";
import { rpgmaker_default_status } from "./item";
import type { RPGMakerLocation } from "./types";

it("文本候选进入预过滤，元数据默认跳过，缺失定位明确失败", () => {
  expect(
    ["text", "metadata"].map((usage) =>
      rpgmaker_default_status({
        extra_field: {
          rpgmaker_mv_mz: {
            usage,
            internal_file_path: "data/CommonEvents.json",
            location: { kind: "field", path: [] },
          },
        },
      }),
    ),
  ).toEqual(["NONE", "RULE_SKIPPED"]);
  expect(() => rpgmaker_default_status({ extra_field: {} })).toThrow();
});
it("嵌套 JSON 沿父容器识别脚本来源，普通显示字段保留资格", () => {
  const field: RPGMakerLocation = { kind: "field", path: ["text"] };
  const script: RPGMakerLocation = {
    kind: "script",
    container: field,
    start: 0,
    end: 8,
    template: false,
  };
  expect(
    [field, script].map((container) =>
      rpgmaker_default_status({
        extra_field: {
          rpgmaker_mv_mz: {
            internal_file_path: "data/CommonEvents.json",
            usage: "text",
            location: {
              kind: "json",
              path: ["text"],
              container: { kind: "json", path: ["inner"], container },
            },
          },
        },
      }),
    ),
  ).toEqual(["NONE", "RULE_SKIPPED"]);
});
