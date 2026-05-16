import { describe, expect, it } from "vitest";

import {
  TransItemMetadataAssetIndex,
  TransItemMetadataMigration,
} from "./trans-item-metadata-migration";

describe("TransItemMetadataMigration", () => {
  it("把旧 TRANS aqua 标签和确定行定位迁为正式 metadata", () => {
    const item = {
      src: "强制翻译行",
      file_type: "TRANS",
      file_path: "demo.trans",
      tag: "script.json",
      row: 3,
      extra_field: { tag: ["aqua"] },
    };
    const asset_index = create_asset_index([
      {
        asset_path: "demo.trans",
        file_key: "script.json",
        row_index: 8,
        global_row: 3,
        src: "强制翻译行",
      },
    ]);

    const changed = TransItemMetadataMigration.normalize_item_payload(
      item,
      "TRANS",
      asset_index,
    );

    expect(changed).toBe(true);
    expect(item).toEqual({
      src: "强制翻译行",
      file_type: "TRANS",
      file_path: "demo.trans",
      tag: "script.json",
      row: 3,
      extra_field: {
        tag: ["aqua"],
        trans_ref: { file_key: "script.json", row_index: 8 },
      },
      skip_internal_filter: true,
    });
  });

  it("保留已有合法 trans_ref 和布尔强制过滤事实", () => {
    const item = {
      src: "文本",
      file_type: "TRANS",
      extra_field: { trans_ref: { file_key: "current.json", row_index: 1 } },
      skip_internal_filter: false,
    };

    const changed = TransItemMetadataMigration.normalize_item_payload(
      item,
      "TRANS",
      create_asset_index([
        {
          asset_path: "demo.trans",
          file_key: "other.json",
          row_index: 0,
          global_row: 0,
          src: "文本",
        },
      ]),
    );

    expect(changed).toBe(false);
    expect(item).toEqual({
      src: "文本",
      file_type: "TRANS",
      extra_field: { trans_ref: { file_key: "current.json", row_index: 1 } },
      skip_internal_filter: false,
    });
  });

  it("无法由旧字段唯一指向原始行时不猜测 trans_ref", () => {
    const item = {
      src: "文本已变",
      file_type: "TRANS",
      file_path: "demo.trans",
      tag: "script.json",
      row: 0,
      extra_field: { tag: [] },
      skip_internal_filter: "yes",
    };

    const changed = TransItemMetadataMigration.normalize_item_payload(
      item,
      "TRANS",
      create_asset_index([
        {
          asset_path: "demo.trans",
          file_key: "script.json",
          row_index: 0,
          global_row: 0,
          src: "原始文本",
        },
      ]),
    );

    expect(changed).toBe(true);
    expect(item).toEqual({
      src: "文本已变",
      file_type: "TRANS",
      file_path: "demo.trans",
      tag: "script.json",
      row: 0,
      extra_field: { tag: [] },
    });
  });

  it("只在 TRANS aqua 条目上推导 skip_internal_filter", () => {
    const trans_without_aqua = {
      file_type: "TRANS",
      extra_field: { tag: [] },
    };
    const non_trans_aqua = {
      file_type: "TXT",
      extra_field: { tag: ["aqua"] },
    };

    expect(
      TransItemMetadataMigration.normalize_item_payload(
        trans_without_aqua,
        "TRANS",
      ),
    ).toBe(false);
    expect(TransItemMetadataMigration.normalize_item_payload(non_trans_aqua, "TXT")).toBe(false);
    expect(trans_without_aqua).toEqual({ file_type: "TRANS", extra_field: { tag: [] } });
    expect(non_trans_aqua).toEqual({ file_type: "TXT", extra_field: { tag: ["aqua"] } });
  });
});

function create_asset_index(
  refs: Array<{
    asset_path: string;
    file_key: string;
    row_index: number;
    global_row: number;
    src: string;
  }>,
): TransItemMetadataAssetIndex {
  const refs_by_asset_path = new Map<
    string,
    Array<{ file_key: string; row_index: number; global_row: number; src: string }>
  >();
  for (const ref of refs) {
    const bucket = refs_by_asset_path.get(ref.asset_path) ?? [];
    bucket.push({
      file_key: ref.file_key,
      row_index: ref.row_index,
      global_row: ref.global_row,
      src: ref.src,
    });
    refs_by_asset_path.set(ref.asset_path, bucket);
  }
  return new TransItemMetadataAssetIndex(refs_by_asset_path);
}
