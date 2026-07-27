import { describe, expect, it } from "vitest";

import { run_ts_conversion_worker_task } from "./ts-conversion-worker-task";

describe("ts-conversion-worker-task", () => {
  it("把 worker 输入直接委托给 shared 转换器", () => {
    const converted = run_ts_conversion_worker_task({
      items: [{ item_id: 1, dst: "后台", name_dst: null, text_type: "NONE" }],
      direction: "s2t",
      convert_name: false,
      preserve_text: false,
      text_preserve_mode: "smart",
      custom_rules: [],
      preset_rules_by_text_type: {},
    });
    expect(converted).toEqual([{ item_id: 1, dst: "後臺", name_dst: null }]);
  });
});
