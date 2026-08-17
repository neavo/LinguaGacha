import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES,
  AGENT_WORKSPACE_METHOD_RESOURCE_PATHS,
} from "../../shared/backend-runtime";
import {
  AgentWorkspaceInvalidError,
  DesktopAgentWorkspaceFiles,
} from "./desktop-agent-workspace-files";

let workspace_path = "";
let session_root = "";
const VALID_LITERAL_PATTERN = { key: "term", text: "A", case_sensitive: true } as const;

beforeEach(() => {
  session_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-workspace-files-"));
  workspace_path = path.join(session_root, "workspace");
  fs.mkdirSync(path.join(workspace_path, "items"), { recursive: true });
  fs.mkdirSync(path.join(workspace_path, "changes", "items"), { recursive: true });
  fs.mkdirSync(path.join(workspace_path, "glossary"), { recursive: true });
  fs.mkdirSync(path.join(workspace_path, "methods"), { recursive: true });
  fs.mkdirSync(path.join(workspace_path, "scratch"), { recursive: true });
  fs.mkdirSync(path.join(session_root, "task"), { recursive: true });
  fs.mkdirSync(path.join(session_root, "sources", "book.epub", "OPS"), { recursive: true });
  fs.writeFileSync(
    path.join(session_root, "sources", "book.epub", "OPS", "chapter.xhtml"),
    "<p>章节</p>",
  );
  fs.writeFileSync(
    path.join(workspace_path, "contract.json"),
    JSON.stringify({
      changes: {
        items: { updates: { path: "changes/items/updates.jsonl" } },
      },
      datasets: { items: { path: "items/entries.jsonl" } },
    }),
  );
  fs.writeFileSync(
    path.join(workspace_path, "items", "entries.jsonl"),
    [
      { item_id: 1, src: "Straße STRASSE", name_src: "Alice" },
      { item_id: 2, src: "strasse", name_src: "Straße" },
      { item_id: 3, src: "无关", name_src: "" },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n") + "\n",
  );
  fs.writeFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "original");
  fs.writeFileSync(path.join(workspace_path, "project_meta.json"), "metadata");
  for (const method_path of Object.values(AGENT_WORKSPACE_METHOD_RESOURCE_PATHS)) {
    fs.writeFileSync(
      path.join(workspace_path, method_path),
      `return ${JSON.stringify(method_path)};`,
    );
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(session_root, { recursive: true, force: true });
});

describe("DesktopAgentWorkspaceFiles", () => {
  it("事务内读取 upper，回滚只丢弃本次修改", async () => {
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path);
    expect(await put(files, "changes/items/updates.jsonl", "step-10")).toHaveProperty(
      "status",
      204,
    );
    expect(await read(files, "changes/items/updates.jsonl")).toBe("step-10");
    expect(
      fs.readFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "utf-8"),
    ).toBe("original");

    await files.rollback();

    expect(
      fs.readFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "utf-8"),
    ).toBe("original");
  });

  it("连续成功运行累积到稳定基线，后续失败不撤销此前提交", async () => {
    const first = await DesktopAgentWorkspaceFiles.open(workspace_path);
    await put(first, "changes/items/updates.jsonl", "step-9");
    await first.commit();

    const second = await DesktopAgentWorkspaceFiles.open(workspace_path);
    await put(second, "changes/items/updates.jsonl", "broken-step-10");
    await second.rollback();

    expect(
      fs.readFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "utf-8"),
    ).toBe("step-9");
  });

  it("scratch 删除和新写入组成合并视图，事务目录不可见也不可访问", async () => {
    fs.writeFileSync(path.join(workspace_path, "scratch", "old.txt"), "old");
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path);
    await files.handle(
      new Request("lg-agent-workspace://workspace/files/scratch/old.txt", { method: "DELETE" }),
    );
    await put(files, "scratch/new.txt", "new");

    const listed = await files.handle(
      new Request("lg-agent-workspace://workspace/__list__?path=scratch"),
    );
    expect(await listed.json()).toEqual([{ name: "new.txt", type: "file", size_bytes: 3 }]);
    const root = await files.handle(new Request("lg-agent-workspace://workspace/__list__"));
    expect(await root.text()).not.toContain(".transactions");
    const hidden = await files.handle(
      new Request("lg-agent-workspace://workspace/files/.transactions/secret"),
    );
    expect(hidden.status).toBe(400);

    await files.commit();
    expect(fs.existsSync(path.join(workspace_path, "scratch", "old.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(workspace_path, "scratch", "new.txt"), "utf-8")).toBe("new");
  });

  it("task 挂载独立于 snapshot，并参与同一脚本事务", async () => {
    fs.writeFileSync(path.join(session_root, "task", "old.txt"), "old");
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path);
    expect(await read(files, "task/old.txt")).toBe("old");
    await files.handle(
      new Request("lg-agent-workspace://workspace/files/task/old.txt", { method: "DELETE" }),
    );
    await put(files, "task/nested/state.json", '{"step":1}\n');

    const listed = await files.handle(
      new Request("lg-agent-workspace://workspace/__list__?path=task"),
    );
    expect(await listed.json()).toEqual([{ name: "nested", type: "directory" }]);
    const root = await files.handle(new Request("lg-agent-workspace://workspace/__list__"));
    expect(await root.json()).toContainEqual({ name: "task", type: "directory" });

    await files.commit();
    expect(fs.existsSync(path.join(session_root, "task", "old.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(session_root, "task", "nested", "state.json"), "utf-8")).toBe(
      '{"step":1}\n',
    );

    const retry = await DesktopAgentWorkspaceFiles.open(workspace_path);
    await put(retry, "task/nested/state.json", '{"step":2}\n');
    await retry.rollback();
    expect(fs.readFileSync(path.join(session_root, "task", "nested", "state.json"), "utf-8")).toBe(
      '{"step":1}\n',
    );
  });

  it("读取全部固定方法源码", async () => {
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path);

    await expect(files.read_method_sources()).resolves.toEqual(
      Object.fromEntries(
        Object.entries(AGENT_WORKSPACE_METHOD_RESOURCE_PATHS).map(([name, method_path]) => [
          name,
          `return ${JSON.stringify(method_path)};`,
        ]),
      ),
    );
    await files.rollback();
  });

  it("通过只读 sources 挂载读取原文件文本，并在 list 中返回文件大小", async () => {
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path);

    expect(await read(files, "sources/book.epub/OPS/chapter.xhtml")).toBe("<p>章节</p>");
    const root = await files.handle(new Request("lg-agent-workspace://workspace/__list__"));
    expect(await root.json()).toContainEqual({ name: "sources", type: "directory" });
    const entries = await files.handle(
      new Request("lg-agent-workspace://workspace/__list__?path=sources/book.epub/OPS"),
    );
    expect(await entries.json()).toEqual([
      { name: "chapter.xhtml", type: "file", size_bytes: Buffer.byteLength("<p>章节</p>") },
    ]);
    expect((await put(files, "sources/book.epub/OPS/chapter.xhtml", "changed")).status).toBe(403);
    await files.rollback();
  });

  it("正式字面匹配一次扫描 src 与 name_src，并区分并集、字段和证据计数", async () => {
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path);
    const response = await files.handle(
      new Request("lg-agent-workspace://workspace/__match_literals__", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patterns: [
            { key: "folded", text: "STRASSE", case_sensitive: false },
            { key: "exact", text: "STRASSE", case_sensitive: true },
          ],
          examples_per_pattern: 2,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      scanned_item_count: 3,
      matched_item_count: 2,
      patterns: [
        {
          key: "folded",
          matched_item_count: 2,
          field_item_counts: { src: 2, name_src: 1 },
          example_matches: [
            {
              item_id: 1,
              field: "src",
              ranges: [
                { start: 0, end: 6 },
                { start: 7, end: 14 },
              ],
            },
            { item_id: 2, field: "src", ranges: [{ start: 0, end: 7 }] },
          ],
        },
        {
          key: "exact",
          matched_item_count: 1,
          field_item_counts: { src: 1, name_src: 0 },
          example_matches: [{ item_id: 1, field: "src", ranges: [{ start: 7, end: 14 }] }],
        },
      ],
    });
    await files.rollback();
  });

  it("模糊相关搜索校验参数并委托当前工作区", async () => {
    const related_search = vi.fn(async () => ({
      indexed_item_count: 3,
      queries: [{ key: "forest", results: [] }],
    }));
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path, related_search);
    const response = await files.handle(
      new Request("lg-agent-workspace://workspace/__find_related_items__", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          queries: [{ key: "forest", text: "森の騎士" }],
          file_paths: ["book.txt"],
          limit: 5,
          context_items: 2,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      indexed_item_count: 3,
      queries: [{ key: "forest", results: [] }],
    });
    expect(related_search).toHaveBeenCalledWith(
      workspace_path,
      {
        queries: [{ key: "forest", text: "森の騎士" }],
        file_paths: ["book.txt"],
        limit: 5,
        context_items: 2,
      },
      expect.any(AbortSignal),
    );
    await files.rollback();
  });

  it("模糊相关搜索拒绝重复 key", async () => {
    const related_search = vi.fn();
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path, related_search);
    const response = await files.handle(
      new Request("lg-agent-workspace://workspace/__find_related_items__", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          queries: [
            { key: "same", text: "森" },
            { key: "same", text: "騎士" },
          ],
          file_paths: [],
          limit: 5,
          context_items: 0,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(related_search).not.toHaveBeenCalled();
    await files.rollback();
  });

  it("正式字面匹配保留 JSON 字符串内的 Unicode 行分隔符", async () => {
    fs.writeFileSync(
      path.join(workspace_path, "items", "entries.jsonl"),
      `${JSON.stringify({ item_id: 1, src: "前\u2028後", name_src: "名\u2029字" })}\n`,
    );
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path);
    const response = await files.handle(
      new Request("lg-agent-workspace://workspace/__match_literals__", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patterns: [
            { key: "body", text: "後", case_sensitive: true },
            { key: "name", text: "字", case_sensitive: true },
          ],
          examples_per_pattern: 1,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      scanned_item_count: 1,
      matched_item_count: 1,
      patterns: [
        { key: "body", matched_item_count: 1, field_item_counts: { src: 1, name_src: 0 } },
        { key: "name", matched_item_count: 1, field_item_counts: { src: 0, name_src: 1 } },
      ],
    });
    await files.rollback();
  });

  it.each([
    {
      label: "重复 pattern key",
      payload: {
        patterns: [VALID_LITERAL_PATTERN, { ...VALID_LITERAL_PATTERN, text: "B" }],
        examples_per_pattern: 1,
      },
    },
    {
      label: "空 pattern text",
      payload: {
        patterns: [{ ...VALID_LITERAL_PATTERN, text: "" }],
        examples_per_pattern: 1,
      },
    },
    {
      label: "缺失 case_sensitive",
      payload: { patterns: [{ key: "flag", text: "A" }], examples_per_pattern: 1 },
    },
    {
      label: "越界证据数量",
      payload: {
        patterns: [VALID_LITERAL_PATTERN],
        examples_per_pattern: AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES + 1,
      },
    },
  ])("正式字面匹配拒绝$label", async ({ payload }) => {
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path);
    const response = await files.handle(
      new Request("lg-agent-workspace://workspace/__match_literals__", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(400);
    await files.rollback();
  });

  it("contract 根结构损坏时拒绝建立文件会话", async () => {
    fs.writeFileSync(path.join(workspace_path, "contract.json"), "[]");

    await expect(DesktopAgentWorkspaceFiles.open(workspace_path)).rejects.toBeInstanceOf(
      AgentWorkspaceInvalidError,
    );
  });

  it("固定方法资源缺失时拒绝建立文件会话", async () => {
    fs.rmSync(path.join(workspace_path, AGENT_WORKSPACE_METHOD_RESOURCE_PATHS.queryItems));

    const files = await DesktopAgentWorkspaceFiles.open(workspace_path);
    await expect(files.read_method_sources()).rejects.toBeInstanceOf(AgentWorkspaceInvalidError);
    await files.rollback();
  });

  it("提交安装失败会恢复基线并报告 preserved", async () => {
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path);
    await put(files, "changes/items/updates.jsonl", "changed");
    const original_rename = fs.promises.rename.bind(fs.promises);
    let failed = false;
    vi.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
      if (!failed && String(from).includes(`${path.sep}upper${path.sep}`)) {
        failed = true;
        throw new Error("injected rename failure");
      }
      await original_rename(from, to);
    });

    await expect(files.commit()).rejects.toMatchObject({
      workspacePreserved: true,
    });
    expect(
      fs.readFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "utf-8"),
    ).toBe("original");
  });

  it("停止发生在提交过程中时反向恢复已经移动的基线", async () => {
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path);
    await put(files, "changes/items/updates.jsonl", "changed");
    const controller = new AbortController();
    const original_rename = fs.promises.rename.bind(fs.promises);
    vi.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
      await original_rename(from, to);
      if (String(to).includes(`${path.sep}backup${path.sep}`)) {
        controller.abort(new Error("用户停止"));
      }
    });

    await expect(files.commit(controller.signal)).rejects.toMatchObject({
      workspacePreserved: true,
    });
    expect(
      fs.readFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "utf-8"),
    ).toBe("original");
  });

  it("写入流失败时保留基线并清理 upper 临时文件", async () => {
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        controller.error(new Error("stream failed"));
      },
    });

    const response = await files.handle(
      new Request("lg-agent-workspace://workspace/files/changes/items/updates.jsonl", {
        method: "PUT",
        body,
        duplex: "half",
      } as RequestInit),
    );

    expect(response.status).toBe(400);
    expect(
      fs.readFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "utf-8"),
    ).toBe("original");
    const transaction = fs.readdirSync(path.join(workspace_path, ".transactions"))[0];
    if (transaction === undefined) throw new Error("缺少事务目录");
    expect(
      fs.readdirSync(
        path.join(workspace_path, ".transactions", transaction, "upper", "changes", "items"),
      ),
    ).toEqual([]);
    await files.rollback();
  });

  it("提交前拒绝被替换为符号链接的 scratch 路径", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-workspace-outside-"));
    const link_path = path.join(workspace_path, "scratch", "link");
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(outside, link_path, "junction");
    try {
      const files = await DesktopAgentWorkspaceFiles.open(workspace_path);
      expect(await put(files, "scratch/link/secret.txt", "changed")).toHaveProperty("status", 204);

      await expect(files.commit()).rejects.toMatchObject({ workspacePreserved: true });
      expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf-8")).toBe("secret");
    } finally {
      fs.unlinkSync(link_path);
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("提交前拒绝 task 内容中的符号链接逃逸", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-task-outside-"));
    const link_path = path.join(session_root, "task", "link");
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(outside, link_path, "junction");
    try {
      const files = await DesktopAgentWorkspaceFiles.open(workspace_path);
      expect(await put(files, "task/link/secret.txt", "changed")).toHaveProperty("status", 400);
      await files.rollback();
      expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf-8")).toBe("secret");
    } finally {
      fs.unlinkSync(link_path);
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("大只读文件不进入 upper，非法路径与受保护文件删除被拒绝", async () => {
    fs.writeFileSync(
      path.join(workspace_path, "glossary", "large.bin"),
      Buffer.alloc(2 * 1024 * 1024),
    );
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path);
    await put(files, "changes/items/updates.jsonl", "changed");
    const transaction = fs.readdirSync(path.join(workspace_path, ".transactions"))[0];
    if (transaction === undefined) throw new Error("缺少事务目录");
    expect(
      fs.existsSync(path.join(workspace_path, ".transactions", transaction, "upper", "glossary")),
    ).toBe(false);
    expect((await put(files, "project_meta.json", "changed")).status).toBe(403);
    expect((await put(files, "items/entries.jsonl", "changed")).status).toBe(403);
    expect((await put(files, "scratch", "changed")).status).toBe(403);
    expect(
      (
        await files.handle(
          new Request("lg-agent-workspace://workspace/files/task", { method: "DELETE" }),
        )
      ).status,
    ).toBe(403);
    for (const encoded_path of ["%2e%2e%2fsecret", "C%3A/secret", "items%5Centries.jsonl"]) {
      expect(
        (await files.handle(new Request(`lg-agent-workspace://workspace/files/${encoded_path}`)))
          .status,
      ).toBe(400);
    }
    expect(
      (
        await files.handle(
          new Request("lg-agent-workspace://workspace/files/changes/items/updates.jsonl", {
            method: "DELETE",
          }),
        )
      ).status,
    ).toBe(403);
    await files.rollback();
  });
});

/** 通过真实私有协议写入当前事务视图。 */
async function put(
  files: DesktopAgentWorkspaceFiles,
  relative_path: string,
  body: string,
): Promise<Response> {
  return await files.handle(
    new Request(`lg-agent-workspace://workspace/files/${relative_path}`, { method: "PUT", body }),
  );
}

/** 通过真实私有协议读取合并后的当前视图。 */
async function read(files: DesktopAgentWorkspaceFiles, relative_path: string): Promise<string> {
  return await (
    await files.handle(new Request(`lg-agent-workspace://workspace/files/${relative_path}`))
  ).text();
}
