import { describe, expect, it } from "vitest";

import {
  PROOFREADING_WARNING_CODES,
  PROOFREADING_WARNING_FILTER_CODES,
  clone_proofreading_filter_options,
  compress_proofreading_text,
  format_proofreading_glossary_term,
  resolve_default_proofreading_warning_types,
  resolve_proofreading_status_sort_rank,
} from "./proofreading-types";

describe("proofreading types", () => {
  it("区分真实警告与 GUI 无警告虚拟筛选值", () => {
    expect(PROOFREADING_WARNING_CODES).toEqual([
      "KANA",
      "HANGEUL",
      "TEXT_PRESERVE",
      "SIMILARITY",
      "GLOSSARY",
      "RETRY_THRESHOLD",
    ]);
    expect(PROOFREADING_WARNING_FILTER_CODES).toEqual([
      "NO_WARNING",
      ...PROOFREADING_WARNING_CODES,
    ]);
  });

  it("格式化术语、压缩换行并将未知状态排在已知状态之后", () => {
    expect(format_proofreading_glossary_term({ src: "魔法", dst: "Magic" })).toBe("魔法 -> Magic");
    expect(compress_proofreading_text("第一行\n第二行")).toBe("第一行 ↵ 第二行");
    expect(resolve_proofreading_status_sort_rank("NONE")).toBeLessThan(
      resolve_proofreading_status_sort_rank("UNKNOWN"),
    );
  });

  it("克隆筛选项时不会共享术语 ID 数组", () => {
    const filters = {
      warning_types: ["GLOSSARY"],
      statuses: ["NONE", "PROCESSED", "ERROR"],
      file_paths: ["chapter.txt"],
      glossary_entry_ids: ["magic"],
      include_without_glossary_miss: true,
    };
    const cloned = clone_proofreading_filter_options(filters);
    cloned.glossary_entry_ids[0] = "dirty";

    expect(filters.warning_types).toEqual(["GLOSSARY"]);
    expect(filters.glossary_entry_ids).toEqual(["magic"]);
  });

  it("默认警告筛选保留已知顺序并追加去重的未知警告", () => {
    expect(
      resolve_default_proofreading_warning_types(["CUSTOM_B", "GLOSSARY", "CUSTOM_A", "CUSTOM_B"]),
    ).toEqual([
      "NO_WARNING",
      "KANA",
      "HANGEUL",
      "TEXT_PRESERVE",
      "SIMILARITY",
      "GLOSSARY",
      "RETRY_THRESHOLD",
      "CUSTOM_A",
      "CUSTOM_B",
    ]);
  });
});
