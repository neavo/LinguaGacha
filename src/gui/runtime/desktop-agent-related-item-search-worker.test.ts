import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run_related_item_search } from "./desktop-agent-related-item-search-worker";

describe("Agent 相关条目检索索引", () => {
  let root = "";
  let workspace_path = "";
  let index_path = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-related-search-"));
    workspace_path = path.join(root, "workspace");
    index_path = path.join(root, "related-item-search", "index.sqlite");
    fs.mkdirSync(path.join(workspace_path, "items"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace_path, "project_meta.json"),
      JSON.stringify({ source_language: "ja" }),
    );
    write_items([
      item(1, "a.txt", "ダリヤは王都近くの森へ採取に向かった。"),
      item(2, "a.txt", "藪から血だらけの黒髪の騎士が現れた。"),
      item(3, "a.txt", "二人はこの日初めて会い、互いに偽名を名乗った。"),
      item(4, "a.txt", "父が夏の靴下を嫌がるので五本指靴下を試作した。"),
      item(5, "a.txt", "濡れた革靴を温風で乾かす靴乾燥機を完成させた。"),
      item(6, "b.txt", "森大蛇を討伐した騎士たちは王都へ戻った。"),
    ]);
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("批量查询返回相关条目、上下文与调用方 key", async () => {
    const result = await search([
      { key: "meeting", text: "ダリヤが森で血だらけの騎士と初めて会う" },
      { key: "dryer", text: "濡れた靴を温風で乾かす魔導具" },
    ]);

    expect(result.indexed_item_count).toBe(6);
    expect(result.queries.map((query) => query.key)).toEqual(["meeting", "dryer"]);
    expect(result.queries[0]?.results[0]).toMatchObject({
      file_path: "a.txt",
      context_item_ids: expect.arrayContaining([1, 2, 3]),
    });
    expect(result.queries[1]?.results[0]).toMatchObject({
      anchor_item_id: 5,
      file_path: "a.txt",
    });
  });

  it("文件过滤只返回指定文件的候选", async () => {
    const result = await search([{ key: "forest", text: "森の騎士" }], ["b.txt"]);

    expect(result.queries[0]?.results).not.toHaveLength(0);
    expect(result.queries[0]?.results.every((entry) => entry.file_path === "b.txt")).toBe(true);
  });

  it("译文变化复用索引，原文变化重建索引", async () => {
    await search([{ key: "dryer", text: "靴乾燥機" }]);
    const first_identity = read_identity();
    const rows = read_items();
    rows[4] = { ...rows[4], dst: "靴子烘干机" };
    write_items(rows);

    await search([{ key: "dryer", text: "靴乾燥機" }]);
    expect(read_identity()).toBe(first_identity);

    rows[4] = { ...rows[4], src: "濡れた長靴を温風で乾かす長靴乾燥機を完成させた。" };
    write_items(rows);
    const rebuilt = await search([{ key: "boots", text: "長靴乾燥機" }]);
    expect(read_identity()).not.toBe(first_identity);
    expect(rebuilt.queries[0]?.results[0]?.anchor_item_id).toBe(5);
  });

  it("损坏缓存会从当前源文重建", async () => {
    fs.mkdirSync(path.dirname(index_path), { recursive: true });
    fs.writeFileSync(index_path, "broken");

    const rebuilt = await search([{ key: "dryer", text: "靴乾燥機" }]);

    expect(rebuilt.queries[0]?.results[0]?.anchor_item_id).toBe(5);
  });

  it("构建中取消会删除临时库且不发布残缺索引", async () => {
    let cancellation_checks = 0;

    await expect(
      run_related_item_search(
        {
          workspacePath: workspace_path,
          indexPath: index_path,
          request: {
            queries: [{ key: "cancelled", text: "森" }],
            file_paths: [],
            limit: 5,
            context_items: 0,
          },
        },
        () => {
          cancellation_checks += 1;
          return cancellation_checks >= 2;
        },
      ),
    ).rejects.toThrow("cancelled");

    expect(fs.existsSync(index_path)).toBe(false);
    expect(
      fs.readdirSync(path.dirname(index_path)).some((name) => name.includes(".building-")),
    ).toBe(false);
  });

  function item(item_id: number, file_path: string, src: string): Record<string, unknown> {
    return { item_id, file_path, src, name_src: "", dst: "", name_dst: "" };
  }

  function write_items(rows: readonly Record<string, unknown>[]): void {
    fs.writeFileSync(
      path.join(workspace_path, "items", "entries.jsonl"),
      `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    );
  }

  function read_items(): Array<Record<string, unknown>> {
    return fs
      .readFileSync(path.join(workspace_path, "items", "entries.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  async function search(
    queries: ReadonlyArray<Readonly<{ key: string; text: string }>>,
    file_paths: readonly string[] = [],
  ) {
    return await run_related_item_search({
      workspacePath: workspace_path,
      indexPath: index_path,
      request: { queries, file_paths, limit: 5, context_items: 2 },
    });
  }

  function read_identity(): string {
    const db = new DatabaseSync(index_path, { readOnly: true });
    try {
      return String(
        (db.prepare("SELECT value FROM metadata WHERE key = 'identity'").get() as { value: string })
          .value,
      );
    } finally {
      db.close();
    }
  }
});
