import { describe, expect, it } from "vitest";

import type { ProjectStoreState } from "@/app/project/store/project-store";
import {
  create_workbench_add_file_plan,
  type WorkbenchFileParsePreview,
} from "@/pages/workbench-page/workbench-mutation-planner";

function create_state(items: Record<string, unknown>): ProjectStoreState {
  return {
    project: {
      path: "E:/demo/sample.lg",
      loaded: true,
    },
    files: {
      "old.txt": {
        rel_path: "old.txt",
        file_type: "TXT",
        sort_index: 0,
      },
    },
    items,
    quality: {
      glossary: { entries: [], enabled: true, mode: "default", revision: 0 },
      pre_replacement: { entries: [], enabled: true, mode: "default", revision: 0 },
      post_replacement: { entries: [], enabled: true, mode: "default", revision: 0 },
      text_preserve: { entries: [], enabled: true, mode: "default", revision: 0 },
    },
    prompts: {
      translation: { text: "", enabled: true, revision: 0 },
      analysis: { text: "", enabled: true, revision: 0 },
    },
    analysis: {},
    proofreading: {
      revision: 0,
    },
    task: {},
    revisions: {
      projectRevision: 1,
      sections: {
        files: 1,
        items: 2,
        analysis: 3,
      },
    },
  };
}

function create_item(args: {
  item_id: number;
  src: string;
  dst: string;
  status?: string;
  name_dst?: unknown;
  retry_count?: number;
}): Record<string, unknown> {
  return {
    item_id: args.item_id,
    file_path: "old.txt",
    row_number: args.item_id,
    src: args.src,
    dst: args.dst,
    name_dst: args.name_dst ?? null,
    status: args.status ?? "PROCESSED",
    text_type: "NONE",
    retry_count: args.retry_count ?? 0,
  };
}

function create_parsed_file(
  parsed_items: Array<Record<string, unknown>>,
): WorkbenchFileParsePreview {
  return {
    source_path: "E:/demo/new.txt",
    target_rel_path: "new.txt",
    file_type: "TXT",
    parsed_items,
  };
}

function get_payload_items(plan: ReturnType<typeof create_workbench_add_file_plan>) {
  return plan.requestBody.parsed_items as Array<Record<string, unknown>>;
}

const SETTINGS = {
  source_language: "JA",
  mtool_optimizer_enable: false,
};

describe("workbench add-file translation inheritance planner", () => {
  it("不继承时保留解析结果", () => {
    const plan = create_workbench_add_file_plan({
      state: create_state({
        "1": create_item({ item_id: 1, src: "hello", dst: "你好" }),
      }),
      parsed_file: create_parsed_file([{ src: "hello", dst: "", row: 1 }]),
      settings: SETTINGS,
      inheritance_mode: "none",
    });

    expect(get_payload_items(plan)[0]?.dst).toBe("");
    expect(get_payload_items(plan)[0]?.status).toBe("NONE");
  });

  it("唯一已完成译文会自动继承", () => {
    const plan = create_workbench_add_file_plan({
      state: create_state({
        "1": create_item({
          item_id: 1,
          src: "hello",
          dst: "你好",
          name_dst: "名字",
          retry_count: 2,
        }),
      }),
      parsed_file: create_parsed_file([{ src: "hello", dst: "", row: 1 }]),
      settings: SETTINGS,
      inheritance_mode: "inherit",
    });

    expect(get_payload_items(plan)[0]).toMatchObject({
      dst: "你好",
      name_dst: "名字",
      status: "PROCESSED",
      retry_count: 2,
    });
  });

  it("多候选时自动选择出现次数最多且并列取最早出现的译文", () => {
    const plan = create_workbench_add_file_plan({
      state: create_state({
        "1": create_item({ item_id: 1, src: "hello", dst: "甲" }),
        "2": create_item({ item_id: 2, src: "hello", dst: "乙" }),
        "3": create_item({ item_id: 3, src: "hello", dst: "甲" }),
        "4": create_item({ item_id: 4, src: "tie", dst: "先" }),
        "5": create_item({ item_id: 5, src: "tie", dst: "后" }),
      }),
      parsed_file: create_parsed_file([
        { src: "hello", dst: "", row: 1 },
        { src: "tie", dst: "", row: 2 },
      ]),
      settings: SETTINGS,
      inheritance_mode: "inherit",
    });

    expect(get_payload_items(plan)).toEqual([
      expect.objectContaining({ src: "hello", dst: "甲" }),
      expect.objectContaining({ src: "tie", dst: "先" }),
    ]);
  });

  it("结构性状态不会被继承状态覆盖", () => {
    const plan = create_workbench_add_file_plan({
      state: create_state({
        "1": create_item({ item_id: 1, src: "hello", dst: "你好" }),
      }),
      parsed_file: create_parsed_file([{ src: "hello", dst: "", row: 1, status: "EXCLUDED" }]),
      settings: SETTINGS,
      inheritance_mode: "inherit",
    });

    expect(get_payload_items(plan)[0]).toMatchObject({
      dst: "你好",
      status: "EXCLUDED",
    });
  });
});
