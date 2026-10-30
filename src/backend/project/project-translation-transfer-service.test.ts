import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { create_item } from "../../domain/item";
import { NativeFs } from "../../native/native-fs";
import { NativePathPolicy } from "../../native/native-path";
import { ProjectDatabase } from "../database/database-operations";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectDataReader } from "./project-data-reader";
import { ProjectSessionState } from "./project-session-state";
import { ProjectTranslationTransferService } from "./project-translation-transfer-service";

let directory = "";
let database: ProjectDatabase;
let gate: RuntimeOperationGate;
let session: ProjectSessionState;

/** 创建带条目的真实工程，关闭语言过滤让状态只由本例决定。 */
async function create_project(name: string, items: Record<string, unknown>[]): Promise<string> {
  const file = path.join(directory, `${name}.lg`);
  await database.create_project(file, name);
  await database.transaction(file, (writer) => {
    writer.set_items(
      file,
      items.map((item, index) => create_item({ id: index + 1, file_path: "a.txt", ...item })),
    );
    writer.upsert_meta_entries(file, { source_language: "ALL", target_language: "ZH" });
  });
  return file;
}

/** 读取工程条目的译文与状态。 */
async function read_results(file: string): Promise<Array<[string, string]>> {
  const items = await database.read(file, (reader) =>
    new ProjectDataReader(reader).read_items(file),
  );
  return items.map((item) => [item.dst, item.status]);
}

/** 迁入工程覆盖未完成、失败和已完成条目，并保留用于验证隔离的 Agent 对话。 */
async function create_pair(): Promise<{ source_path: string; base_path: string }> {
  const source_path = await create_project("source", [
    { src: "甲", dst: "A", status: "PROCESSED" },
    { src: "乙", dst: "B", status: "PROCESSED" },
    { src: "丙", dst: "C", status: "PROCESSED" },
  ]);
  const base_path = await create_project("base", [
    { src: "甲" },
    { src: "乙", status: "NONE" },
    { src: "丙", dst: "旧丙", status: "PROCESSED" }, // 上下文与迁出工程一致。
    { src: "丁", file_path: "b.txt" },
  ]);
  const store = database.open_agent_store(base_path);
  await store.create("base-chat");
  await store.close();
  return { source_path, base_path };
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-translation-transfer-"));
  database = new ProjectDatabase("1.0.0");
  gate = new RuntimeOperationGate();
  session = new ProjectSessionState();
});

afterEach(async () => {
  await database.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("ProjectTranslationTransferService", () => {
  it("生成迁入译文的新工程，原工程字节不变，新工程不带 Agent 对话且无残留文件", async () => {
    const { source_path, base_path } = await create_pair();
    const source_bytes = fs.readFileSync(source_path);
    const base_bytes = fs.readFileSync(base_path);
    const output_path = path.join(directory, "output.lg");
    const service = new ProjectTranslationTransferService(database, gate, session);

    await expect(
      service.apply({ source_path, base_path, output_path, mode: "overwrite" }),
    ).resolves.toEqual({ filled: 2, replaced: 1, unmatched: 1 });

    expect(await read_results(output_path)).toEqual([
      ["A", "PROCESSED"],
      ["B", "PROCESSED"],
      ["C", "PROCESSED"],
      ["", "NONE"],
    ]);
    expect(fs.readFileSync(source_path)).toEqual(source_bytes);
    expect(fs.readFileSync(base_path)).toEqual(base_bytes);
    expect(await database.open_agent_store(output_path).read()).toBeNull();
    expect(await database.open_agent_store(base_path).read()).toMatchObject({ id: "base-chat" });
    expect(fs.readdirSync(directory).sort()).toEqual(["base.lg", "output.lg", "source.lg"]);
  });

  it("运行占用时拒绝且不产生输出", async () => {
    const { source_path, base_path } = await create_pair();
    const output_path = path.join(directory, "output.lg");
    gate.begin_runtime("batch_translation");

    await expect(
      new ProjectTranslationTransferService(database, gate, session).apply({
        source_path,
        base_path,
        output_path,
        mode: "fill",
      }),
    ).rejects.toMatchObject({ code: "runtime.busy" });
    expect(fs.existsSync(output_path)).toBe(false);
  });

  it("输出路径与原工程或已加载工程相同（含大小写差异）时拒绝", async () => {
    const source_path = path.join(directory, "source.lg");
    const base_path = path.join(directory, "base.lg");
    const loaded_path = path.join(directory, "Loaded.lg");
    await session.mark_loaded(loaded_path);
    // 路径冲突在访问文件前判定，按 Windows 规则验证大小写不敏感的比较。
    const service = new ProjectTranslationTransferService(
      database,
      gate,
      session,
      new NativeFs(new NativePathPolicy("win32")),
    );

    for (const output_path of [source_path, base_path.toUpperCase(), loaded_path.toLowerCase()])
      await expect(
        service.apply({ source_path, base_path, output_path, mode: "fill" }),
      ).rejects.toMatchObject({ code: "project.path_conflict" });
  });

  it("中途失败时保留已有输出文件且不留下临时文件", async () => {
    const { base_path } = await create_pair();
    const source_path = path.join(directory, "broken.lg");
    const output_path = path.join(directory, "output.lg");
    fs.writeFileSync(source_path, "not a project");
    fs.writeFileSync(output_path, "existing");

    await expect(
      new ProjectTranslationTransferService(database, gate, session).apply({
        source_path,
        base_path,
        output_path,
        mode: "fill",
      }),
    ).rejects.toThrow();
    expect(fs.readFileSync(output_path, "utf-8")).toBe("existing");
    expect(fs.readdirSync(directory).sort()).toEqual([
      "base.lg",
      "broken.lg",
      "output.lg",
      "source.lg",
    ]);
  });
});
