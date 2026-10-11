import { expect, it } from "vitest";
import { rpgmaker_default_status } from "./item";

it("显示和脚本进入预过滤，元数据与缺少用途的条目保持默认跳过", () => {
  expect(
    ["display", "script", "metadata"].map((usage) =>
      rpgmaker_default_status({ rpgmaker: { usage } }),
    ),
  ).toEqual(["NONE", "NONE", "RULE_SKIPPED"]);
  expect(rpgmaker_default_status({})).toBe("RULE_SKIPPED");
});
