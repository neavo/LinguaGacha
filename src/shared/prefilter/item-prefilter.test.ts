import { describe, expect, it } from "vitest";
import { read_item_translation_candidates } from "./item-prefilter";

describe("read_item_translation_candidates", () => {
  it("移除姓名中的纯资源引用，保留文字与资源混合的姓名及原始字段边界", () => {
    expect(
      read_item_translation_candidates({ src: "……", name_src: "data:image/png;base64,AAAA" }),
    ).toEqual([]);
    expect(
      read_item_translation_candidates({ src: "EV12", name_src: ["Alice image.png", "附加字段"] }),
    ).toEqual([{ field: "name_src", text: "Alice image.png" }]);
  });

  it("强制翻译绕过内容规则并只读取可见姓名槽位", () => {
    expect(
      read_item_translation_candidates({
        src: "EV12",
        name_src: ["…", "附加字段"],
        skip_internal_filter: true,
      }),
    ).toEqual([
      { field: "src", text: "EV12" },
      { field: "name_src", text: "…" },
    ]);
  });
});
