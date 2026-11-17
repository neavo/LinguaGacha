import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { prepare_agent_workspace_changes } from "./changes";
import { AGENT_WORKSPACE_CHANGE_PATHS, AGENT_WORKSPACE_CHANGE_OPERATIONS } from "./paths";
import { QUALITY_RULE_KINDS, QualityRule } from "../../../domain/quality";

const workspaces: string[] = [];

it("知识整篇更新按 JSONL 收窄，坏行不进入意图", async () => {
  const workspace = create_workspace();
  write(
    workspace,
    AGENT_WORKSPACE_CHANGE_PATHS.knowledge.updates,
    [
      JSON.stringify({ fp: "abcd", text: "多行\n正文" }),
      JSON.stringify({ path: "notes.md", fp: "abcd", text: "旧结构" }),
    ].join("\n"),
  );
  const parsed = await prepare_agent_workspace_changes({
    nativeFs: new NativeFs(),
    workspacePath: workspace,
  });
  expect(parsed.batch.knowledge).toEqual([{ fp: "abcd", text: "多行\n正文", line: 1 }]);
  expect(parsed.rejected).toMatchObject([
    { scope: "knowledge", line: 2, reason: "invalid_change" },
  ]);
});

describe("Agent workspace change parser", () => {
  it("文件记录解析保留行号，缺少更新字段和非整数排序均拒绝", async () => {
    const workspace = create_workspace();
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS.files.creates,
      JSON.stringify({
        source_path: "work/game",
        godot_pack_orders: [{ game_root: "D:/game", ordered_pcks: ["a.pck", "b.pck"] }],
        inheritance_mode: "inherit",
      }),
    );
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS.files.updates,
      [
        { file_path: "a.txt", new_file_path: "folder/a.txt", sort: -1 },
        { file_path: "b.txt" },
        { file_path: "c.txt", sort: 1.5 },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS.files.replaces,
      JSON.stringify({
        file_path: "book.image",
        source_path: "work/book.image",
        inheritance_mode: "inherit",
      }),
    );
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS.files.deletes,
      JSON.stringify({ file_path: "b.txt" }),
    );
    const parsed = await prepare_agent_workspace_changes({
      nativeFs: new NativeFs(),
      workspacePath: workspace,
    });
    expect(parsed.files.replaces).toEqual([
      {
        line: 1,
        file_path: "book.image",
        source_path: "work/book.image",
        inheritance_mode: "inherit",
      },
    ]);
    expect(parsed.files.creates).toMatchObject([
      { line: 1, source_path: "work/game", inheritance_mode: "inherit" },
    ]);
    expect(parsed.files.updates).toEqual([
      { line: 1, file_path: "a.txt", new_file_path: "folder/a.txt", sort: -1 },
    ]);
    expect(parsed.files.deletes).toEqual([{ line: 1, file_path: "b.txt" }]);
    expect(parsed.rejected.map((row) => [row.scope, row.line])).toEqual([
      ["files", 2],
      ["files", 3],
    ]);
  });
  it("提示词更新接受 null 和空字符串，拒绝其它类型", async () => {
    const workspace = create_workspace();
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
      [null, "", 42]
        .map((text) => JSON.stringify({ kind: "translation", fp: "abcd", text }))
        .join("\n"),
    );
    const parsed = await prepare_agent_workspace_changes({
      nativeFs: new NativeFs(),
      workspacePath: workspace,
    });
    expect(parsed.batch.prompts.map((intent) => intent.text)).toEqual([null, ""]);
    expect(parsed.rejected).toHaveLength(1);
  });
  it.each(QUALITY_RULE_KINDS)("%s 创建与更新拒绝非法 src，更新仍允许省略 src", async (kind) => {
    const workspace = create_workspace();
    const fields = QualityRule.from_json(kind).normalize_entry({ src: "合法" });
    const invalid_sources = ["", " \t\n\u3000", 12, null, false];
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS[kind].creates,
      [...invalid_sources.map((src) => ({ ...fields, src, sort: -1 })), { ...fields, sort: -1 }]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS[kind].updates,
      [
        ...invalid_sources.map((src) => ({ id: "rule", fp: "abcd", src })),
        { id: "rule", fp: "abcd", sort: -1 },
        { id: "rule", fp: "abcd", src: " 合法 " },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );
    const parsed = await prepare_agent_workspace_changes({
      nativeFs: new NativeFs(),
      workspacePath: workspace,
    });
    expect(parsed.batch.quality[kind].creates).toHaveLength(1);
    expect(parsed.batch.quality[kind].updates.map((row) => row.fields)).toEqual([
      {},
      { src: " 合法 " },
    ]);
    expect(parsed.rejected).toHaveLength(invalid_sources.length * 2);
    expect(parsed.rejected.every((row) => row.reason === "invalid_change")).toBe(true);
  });
  afterEach(() => {
    for (const workspace of workspaces) fs.rmSync(workspace, { recursive: true, force: true });
    workspaces.length = 0;
  });

  it("坏行只拒绝对应输入并保留相邻合法行", async () => {
    const workspace = create_workspace();
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
      [
        JSON.stringify({ item_id: 1, fp: "abcd", dst: "甲" }),
        "{broken",
        JSON.stringify({ item_id: 2, fp: "ghij", dst: "乙" }),
      ].join("\n"),
    );
    const page = {
      file_path: "book.pdf",
      page: 1,
      fp: "abcd",
      translation: null,
      reviewed: false,
      notes: "",
    };
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS.pages.updates,
      [page, { ...page, page: 2, reviewed: "invalid" }]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );
    const parsed = await prepare_agent_workspace_changes({
      nativeFs: new NativeFs(),
      workspacePath: workspace,
    });
    expect(parsed.batch.pages).toEqual([{ ...page, line: 1 }]);
    expect(parsed.rejected).toContainEqual(
      expect.objectContaining({
        scope: "pages",
        file_path: "book.pdf",
        page: 2,
        line: 2,
        reason: "invalid_change",
      }),
    );
    expect(parsed.batch.items.map((row) => row.item_id)).toEqual([1, 2]);
    expect(parsed.rejected).toContainEqual(
      expect.objectContaining({
        scope: "items",
        op: "update",
        line: 2,
        reason: "invalid_change",
        message: "Change line contains invalid JSON.",
      }),
    );
  });

  it("Item 状态变更只接受人工状态", async () => {
    const workspace = create_workspace();
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
      [
        JSON.stringify({ item_id: 1, fp: "abcd", status: "NONE" }),
        JSON.stringify({ item_id: 2, fp: "ghij", status: "DUPLICATED" }),
      ].join("\n"),
    );

    const parsed = await prepare_agent_workspace_changes({
      nativeFs: new NativeFs(),
      workspacePath: workspace,
    });

    expect(parsed.batch.items).toEqual([
      { line: 1, item_id: 1, fp: "abcd", update: { status: "NONE" } },
    ]);
    expect(parsed.rejected).toContainEqual(
      expect.objectContaining({
        scope: "items",
        op: "update",
        id: 2,
        reason: "invalid_change",
      }),
    );
  });

  it("create 的未知字段只拒绝对应行", async () => {
    const workspace = create_workspace();
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS.glossary.creates,
      JSON.stringify({
        src: "甲",
        dst: "X",
        info: "",
        case_sensitive: false,
        sort: 0,
        extra: true,
      }),
    );
    const parsed = await prepare_agent_workspace_changes({
      nativeFs: new NativeFs(),
      workspacePath: workspace,
    });
    expect(parsed.rejected).toContainEqual(
      expect.objectContaining({
        scope: "quality",
        kind: "glossary",
        op: "create",
        src: "甲",
        reason: "invalid_change",
      }),
    );
  });

  it("按对象契约解析 prompt 与 quality 意图并拒绝缺失指纹", async () => {
    const workspace = create_workspace();
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
      [
        JSON.stringify({ kind: "translation", fp: "abcd", text: "正文" }),
        JSON.stringify({ kind: "translation", text: "正文" }),
      ].join("\n"),
    );
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS.glossary.updates,
      JSON.stringify({ id: "term-1", fp: "ghij", sort: -1 }),
    );
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS.glossary.deletes,
      JSON.stringify({ id: "term-2", fp: "mnop" }),
    );

    const parsed = await prepare_agent_workspace_changes({
      nativeFs: new NativeFs(),
      workspacePath: workspace,
    });

    expect(parsed.batch.prompts).toEqual([
      { line: 1, kind: "translation", fp: "abcd", text: "正文" },
    ]);
    expect(parsed.batch.quality.glossary.updates).toEqual([
      { line: 1, kind: "glossary", id: "term-1", fp: "ghij", fields: {}, sort: -1 },
    ]);
    expect(parsed.batch.quality.glossary.deletes).toEqual([
      { line: 1, kind: "glossary", id: "term-2", fp: "mnop" },
    ]);
    expect(parsed.rejected).toContainEqual(
      expect.objectContaining({
        scope: "prompts",
        op: "update",
        kind: "translation",
        reason: "invalid_change",
      }),
    );
  });
  it("解析入口接受不透明指纹并校验类型、非空和变更字段", async () => {
    const workspace = create_workspace();
    const rows = [
      { item_id: 1, fp: "opaque-fingerprint", dst: "" },
      { item_id: 2, fp: 42, dst: "X" },
      { item_id: 3, fp: "abcd" },
      { item_id: 4, fp: "", dst: "X" },
    ];
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
      rows.map((row) => JSON.stringify(row)).join("\n"),
    );
    const parsed = await prepare_agent_workspace_changes({
      nativeFs: new NativeFs(),
      workspacePath: workspace,
    });
    expect(parsed.batch.items).toEqual([
      { line: 1, item_id: 1, fp: "opaque-fingerprint", update: { dst: "" } },
    ]);
    expect(parsed.rejected).toMatchObject([
      { id: 2, line: 2, path: "/fp", reason: "invalid_change" },
      { id: 3, line: 3, path: "/", reason: "invalid_change" },
      { id: 4, line: 4, path: "/fp", reason: "invalid_change" },
    ]);
  });
});

/** 为解析器建立各类 changes 文件，退出时统一回收。 */
function create_workspace(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-parser-"));
  workspaces.push(workspace);
  for (const relative of [
    AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
    AGENT_WORKSPACE_CHANGE_PATHS.pages.updates,
    AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
    ...QUALITY_RULE_KINDS.flatMap((kind) =>
      AGENT_WORKSPACE_CHANGE_OPERATIONS.map((op) => AGENT_WORKSPACE_CHANGE_PATHS[kind][op]),
    ),
  ]) {
    const file = path.join(workspace, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "", "utf8");
  }
  return workspace;
}

/** 保留真实 JSONL 行边界，便于核对拒绝回执的物理行号。 */
function write(workspace: string, relative: string, value: string): void {
  fs.mkdirSync(path.dirname(path.join(workspace, relative)), { recursive: true });
  fs.writeFileSync(path.join(workspace, relative), `${value}\n`, "utf8");
}
