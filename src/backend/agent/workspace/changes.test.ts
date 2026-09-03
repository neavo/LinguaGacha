import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { prepare_agent_workspace_changes } from "./changes";
import {
  AGENT_WORKSPACE_CHANGE_PATHS,
  AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS,
} from "./contract";
import { QUALITY_RULE_KINDS } from "../../../domain/quality";

const workspaces: string[] = [];

describe("Agent workspace change parser", () => {
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
    const parsed = await prepare_agent_workspace_changes({
      nativeFs: new NativeFs(),
      workspacePath: workspace,
    });
    expect(parsed.batch.items.map((row) => row.item_id)).toEqual([1, 2]);
    expect(parsed.rejected).toContainEqual({
      scope: "items",
      op: "update",
      line: 2,
      reason: "invalid_change",
    });
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
    expect(parsed.rejected).toContainEqual({
      scope: "items",
      op: "update",
      id: 2,
      reason: "invalid_change",
    });
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
    expect(parsed.rejected).toContainEqual({
      scope: "quality",
      kind: "glossary",
      op: "create",
      src: "甲",
      reason: "invalid_change",
    });
  });

  it("按对象契约解析 prompt 与 quality 意图并拒绝格式错误的 fp", async () => {
    const workspace = create_workspace();
    write(
      workspace,
      AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
      [
        JSON.stringify({ kind: "translation", fp: "abcd", text: "正文" }),
        JSON.stringify({ kind: "analysis", fp: "abcde", text: "正文" }),
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
    expect(parsed.rejected).toContainEqual({
      scope: "prompts",
      op: "update",
      kind: "analysis",
      reason: "invalid_change",
    });
  });
});

function create_workspace(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-parser-"));
  workspaces.push(workspace);
  for (const relative of [
    AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
    AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
    ...QUALITY_RULE_KINDS.flatMap((kind) =>
      AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS.map((op) => AGENT_WORKSPACE_CHANGE_PATHS[kind][op]),
    ),
  ]) {
    const file = path.join(workspace, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "", "utf8");
  }
  return workspace;
}

function write(workspace: string, relative: string, value: string): void {
  fs.writeFileSync(path.join(workspace, relative), `${value}\n`, "utf8");
}
