import { expect, it } from "vitest";
import { rpgmaker_default_status } from "./item";

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

it("插件来源优先于文本用途，扩展名不区分大小写", () => {
  expect(
    rpgmaker_default_status({
      extra_field: {
        rpgmaker_mv_mz: {
          usage: "text",
          internal_file_path: "www/js/plugins/nested/Menu.JS",
          location: { kind: "field", path: [] },
        },
      },
    }),
  ).toBe("RULE_SKIPPED");
});
