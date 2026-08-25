import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectItemPublicRecord } from "../../domain/item";
import type { JsonRecord } from "../../domain/json";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../domain/quality";
import { NativeFs } from "../../native/native-fs";
import type { CacheReadPort } from "../cache/cache-types";
import { prepare_agent_workspace_changes } from "./agent-workspace-change";
import {
  AGENT_WORKSPACE_CHANGE_PATHS,
  AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS,
  AGENT_WORKSPACE_QUALITY_CHANGE_PATHS,
} from "./agent-workspace-contract";

describe("Agent 工作区显式 change", () => {
  let workspace_path = "";
  const native_fs = new NativeFs();

  beforeEach(() => {
    workspace_path = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-change-"));
    for (const relative_path of all_change_paths()) {
      fs.mkdirSync(path.dirname(path.join(workspace_path, relative_path)), { recursive: true });
      fs.writeFileSync(path.join(workspace_path, relative_path), "", "utf-8");
    }
  });

  afterEach(() => {
    fs.rmSync(workspace_path, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("items 与 prompts 只读取目标事实，不扫描完整 item 或 quality", async () => {
    const fixture = create_cache();
    write_rows(AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 2, dst: "译文-2" },
      { item_id: 1, name_dst: "名字", status: "PROCESSED" },
    ]);
    write_rows(AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates, [
      { kind: "translation", text: "新翻译提示词" },
    ]);

    const prepared = await prepare_agent_workspace_changes({
      nativeFs: native_fs,
      workspacePath: workspace_path,
      cache: fixture.cache,
    });

    expect(fixture.read_items).not.toHaveBeenCalled();
    expect(fixture.read_item).toHaveBeenCalledTimes(2);
    expect(fixture.read_quality).not.toHaveBeenCalled();
    expect(prepared.itemChanges).toHaveLength(2);
    expect(prepared.itemChanges[0]).toMatchObject({
      item_id: 2,
      next: { dst: "译文-2", status: "PROCESSED" },
    });
    expect(prepared.itemChanges[1]?.next).toMatchObject({
      name_dst: "名字",
      status: "PROCESSED",
      retry_count: 0,
    });
    expect(prepared.promptChanges).toEqual([{ kind: "translation", text: "新翻译提示词" }]);
  });

  it("quality 按 delete、update、create、move 构造单个受影响 kind", async () => {
    const fixture = create_cache();
    write_rows(AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.deletes, [{ id: "g-3" }]);
    write_rows(AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.updates, [{ id: "g-1", dst: "王女" }]);
    write_rows(AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.creates, [
      {
        src: "王子",
        dst: "王子",
        info: "称谓",
        case_sensitive: false,
        before_id: "g-2",
      },
      {
        src: "皇女",
        dst: "皇女",
        info: "称谓",
        case_sensitive: false,
        before_id: "g-2",
      },
    ]);
    write_rows(AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.moves, [
      { id: "g-1", before_id: null },
    ]);

    const prepared = await prepare_agent_workspace_changes({
      nativeFs: native_fs,
      workspacePath: workspace_path,
      cache: fixture.cache,
    });

    expect(fixture.read_quality).toHaveBeenCalledOnce();
    expect(prepared.qualityChanges).toHaveLength(1);
    expect(prepared.qualityChanges[0]?.kind).toBe("glossary");
    expect(prepared.qualityChanges[0]?.entries.map((entry) => entry["src"])).toEqual([
      "王子",
      "皇女",
      "公主",
      "姫",
    ]);
    expect(
      prepared.qualityChanges[0]?.entries.slice(0, 2).map((entry) => entry["entry_id"]),
    ).toEqual([
      expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{5}$/u),
      expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{5}$/u),
    ]);
    expect(
      new Set(prepared.qualityChanges[0]?.entries.map((entry) => entry["entry_id"])).size,
    ).toBe(4);
    expect(prepared.qualityChanges[0]?.entries.at(-1)).toMatchObject({ dst: "王女" });
    expect(prepared.qualitySummary.glossary).toEqual({
      created: 2,
      updated: 1,
      deleted: 1,
      moved: 1,
    });
    expect(prepared.qualityAffectedCounts.glossary).toBe(4);
  });

  it("显式 no-op 与相互抵消的 move 不形成真实 change", async () => {
    const fixture = create_cache();
    write_rows(AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [{ item_id: 1, dst: "" }]);
    write_rows(AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates, [
      { kind: "translation", text: "翻译正文" },
    ]);
    write_rows(AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.updates, [{ id: "g-1", dst: "姫" }]);
    write_rows(AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.moves, [
      { id: "g-1", before_id: "g-3" },
      { id: "g-2", before_id: "g-3" },
    ]);

    await expect(
      prepare_agent_workspace_changes({
        nativeFs: native_fs,
        workspacePath: workspace_path,
        cache: fixture.cache,
      }),
    ).resolves.toEqual({
      itemChanges: [],
      qualityChanges: [],
      promptChanges: [],
      qualitySummary: {},
      qualityAffectedCounts: {},
    });
  });

  it.each([
    {
      name: "重复 item",
      arrange: () =>
        write_rows(AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
          { item_id: 1, dst: "甲" },
          { item_id: 1, dst: "乙" },
        ]),
    },
    {
      name: "同一 quality ID 同时删除和更新",
      arrange: () => {
        write_rows(AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.deletes, [{ id: "g-1" }]);
        write_rows(AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.updates, [
          { id: "g-1", dst: "王女" },
        ]);
      },
    },
    {
      name: "move 指向本次删除的锚点",
      arrange: () => {
        write_rows(AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.deletes, [{ id: "g-1" }]);
        write_rows(AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.moves, [
          { id: "g-2", before_id: "g-1" },
        ]);
      },
    },
  ])("拒绝$name", async ({ arrange }) => {
    const fixture = create_cache();
    arrange();

    await expect(
      prepare_agent_workspace_changes({
        nativeFs: native_fs,
        workspacePath: workspace_path,
        cache: fixture.cache,
      }),
    ).rejects.toMatchObject({ public_details: { action: "workspace_script" } });
  });

  it.each([
    {
      name: "没有人工字段的 item update",
      path: AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
      rows: [{ item_id: 1 }],
    },
    {
      name: "字符串 item ID",
      path: AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
      rows: [{ item_id: "1", dst: "译文" }],
    },
    {
      name: "小数 item ID",
      path: AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
      rows: [{ item_id: 1.5, dst: "译文" }],
    },
    {
      name: "非人工 item 状态",
      path: AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
      rows: [{ item_id: 1, status: "ERROR" }],
    },
    {
      name: "同一 prompt 的平行最终值",
      path: AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
      rows: [
        { kind: "translation", text: "甲" },
        { kind: "translation", text: "乙" },
      ],
    },
    {
      name: "quality update 的未知字段",
      path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.updates,
      rows: [{ id: "g-1", enabled: true }],
    },
    {
      name: "quality create 的空业务身份",
      path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.creates,
      rows: [{ src: "", dst: "公主", info: "", case_sensitive: false }],
    },
    {
      name: "非法正则",
      path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.pre_replacement.creates,
      rows: [{ src: "[", dst: "王女", regex: true, case_sensitive: false }],
    },
    {
      name: "新增重复规则组",
      path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.creates,
      rows: [{ src: "姫", dst: "姬", info: "", case_sensitive: false }],
    },
  ])("拒绝$name", async ({ path: relative_path, rows }) => {
    const fixture = create_cache();
    write_rows(relative_path, rows);

    await expect(
      prepare_agent_workspace_changes({
        nativeFs: native_fs,
        workspacePath: workspace_path,
        cache: fixture.cache,
      }),
    ).rejects.toMatchObject({
      code: "request.validation_failed",
      public_details: { action: "workspace_script" },
    });
  });

  it("损坏 JSONL 统一返回可修复 change 错误", async () => {
    const fixture = create_cache();
    fs.writeFileSync(
      path.join(workspace_path, AGENT_WORKSPACE_CHANGE_PATHS.items.updates),
      "{broken\n",
      "utf-8",
    );

    await expect(
      prepare_agent_workspace_changes({
        nativeFs: native_fs,
        workspacePath: workspace_path,
        cache: fixture.cache,
      }),
    ).rejects.toMatchObject({
      code: "request.validation_failed",
      public_details: { action: "workspace_script" },
    });
  });

  it("change JSONL 保留字段内的 Unicode 行分隔符", async () => {
    const fixture = create_cache();
    write_rows(AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 1, dst: "前\u2028後\u2029" },
    ]);

    const prepared = await prepare_agent_workspace_changes({
      nativeFs: native_fs,
      workspacePath: workspace_path,
      cache: fixture.cache,
    });

    expect(prepared.itemChanges[0]?.next.dst).toBe("前\u2028後\u2029");
  });

  it("一万条确定性更新保持定点读取且不要求完整集合进入模型结果", async () => {
    const items = new Map(
      Array.from({ length: 10_000 }, (_, index) => {
        const item_id = index + 1;
        return [item_id, create_item(item_id)] as const;
      }),
    );
    const read_item = vi.fn((item_id: number) => items.get(item_id) ?? null);
    const cache = create_cache({ read_item }).cache;
    write_rows(
      AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
      Array.from({ length: 10_000 }, (_, index) => ({ item_id: index + 1, dst: `B-${index + 1}` })),
    );

    const prepared = await prepare_agent_workspace_changes({
      nativeFs: native_fs,
      workspacePath: workspace_path,
      cache,
    });

    expect(prepared.itemChanges).toHaveLength(10_000);
    expect(read_item).toHaveBeenCalledTimes(10_000);
  });

  function write_rows(relative_path: string, rows: JsonRecord[]): void {
    fs.writeFileSync(
      path.join(workspace_path, relative_path),
      rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
      "utf-8",
    );
  }
});

/** 构造定点 item 读侧与四类 quality/prompt 快照，并暴露调用证据。 */
function create_cache(
  options: {
    read_item?: (item_id: number) => ProjectItemPublicRecord | null;
  } = {},
): {
  cache: CacheReadPort;
  read_items: ReturnType<typeof vi.fn>;
  read_item: ReturnType<typeof vi.fn>;
  read_quality: ReturnType<typeof vi.fn>;
} {
  const items = new Map([
    [1, create_item(1)],
    [2, create_item(2)],
  ]);
  const read_items = vi.fn(() => [...items.values()]);
  const read_item = vi.fn(options.read_item ?? ((item_id: number) => items.get(item_id) ?? null));
  const read_quality = vi.fn(() => ({
    glossary: {
      entries: [
        create_quality_entry("glossary", "g-1", "姫"),
        create_quality_entry("glossary", "g-2", "公主"),
        create_quality_entry("glossary", "g-3", "殿下"),
      ],
    },
    text_preserve: { entries: [] },
    pre_replacement: { entries: [] },
    post_replacement: { entries: [] },
  }));
  return {
    read_items,
    read_item,
    read_quality,
    cache: {
      items: { readItems: read_items, readItem: read_item },
      files: { readFileEntries: () => [] },
      quality: { readBlock: read_quality },
      prompts: {
        readBlock: () => ({
          translation: { enabled: true, text: "翻译正文" },
          analysis: { enabled: true, text: "分析正文" },
        }),
      },
      analysis: { readBlock: () => ({}) },
      readSectionRevisions: () => ({}),
      snapshot: () => ({
        projectPath: "test.lg",
        epoch: 1,
        freshness: "fresh",
        sectionRevisions: {},
        itemCount: items.size,
      }),
    },
  };
}

/** 构造生产 CacheReadPort 返回的完整公开 item。 */
function create_item(item_id: number): ProjectItemPublicRecord {
  return {
    item_id,
    src: `A-${item_id.toString()}`,
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: item_id - 1,
    file_type: "TXT",
    file_path: "script.txt",
    text_type: "NONE",
    status: "NONE",
    retry_count: 2,
    skip_internal_filter: false,
  };
}

/** 当前解析器测试只需 glossary；其它 kind 在缓存中保持空集合。 */
function create_quality_entry(kind: QualityRuleKind, entry_id: string, src: string): JsonRecord {
  if (kind === "glossary") {
    return { entry_id, src, dst: src, info: "称谓", case_sensitive: false };
  }
  throw new Error("测试只构造 glossary");
}

/** 测试初始化与生产 load 共享同一固定 change 路径集合。 */
function all_change_paths(): string[] {
  return [
    AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
    AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
    ...QUALITY_RULE_KINDS.flatMap((kind) =>
      AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS.map(
        (operation) => AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind][operation],
      ),
    ),
  ];
}
