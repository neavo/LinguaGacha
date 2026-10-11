import { expect, it } from "vitest";
import { rpgmaker_default_status } from "./item";

it("文本候选进入预过滤，元数据与缺少用途的条目保持默认跳过", () => {
  expect(
    ["text", "metadata"].map((usage) =>
      rpgmaker_default_status({
        file_path: "data/CommonEvents.json",
        extra_field: { rpgmaker: { usage } },
      }),
    ),
  ).toEqual(["NONE", "RULE_SKIPPED"]);
  expect(rpgmaker_default_status({ file_path: "data/Actors.json", extra_field: {} })).toBe(
    "RULE_SKIPPED",
  );
});

it("插件来源优先于文本用途，扩展名不区分大小写", () => {
  expect(
    rpgmaker_default_status({
      file_path: "www/js/plugins/nested/Menu.JS",
      extra_field: { rpgmaker: { usage: "text" } },
    }),
  ).toBe("RULE_SKIPPED");
});
