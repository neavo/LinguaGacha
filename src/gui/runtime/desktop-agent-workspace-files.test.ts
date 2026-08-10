import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopAgentWorkspaceFiles } from "./desktop-agent-workspace-files";

let workspace_path = "";

beforeEach(() => {
  workspace_path = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-workspace-files-"));
  fs.mkdirSync(path.join(workspace_path, "items"), { recursive: true });
  fs.mkdirSync(path.join(workspace_path, "changes", "items"), { recursive: true });
  fs.mkdirSync(path.join(workspace_path, "glossary"), { recursive: true });
  fs.mkdirSync(path.join(workspace_path, "recipes"), { recursive: true });
  fs.mkdirSync(path.join(workspace_path, "scratch"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace_path, "contract.json"),
    JSON.stringify({
      changes: {
        items: { updates: { path: "changes/items/updates.jsonl" } },
      },
      recipes: {
        "query-items": { path: "recipes/query-items.js" },
      },
    }),
  );
  fs.writeFileSync(path.join(workspace_path, "items", "entries.jsonl"), "original");
  fs.writeFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "original");
  fs.writeFileSync(path.join(workspace_path, "project_meta.json"), "metadata");
  fs.writeFileSync(path.join(workspace_path, "recipes", "query-items.js"), "return args;");
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(workspace_path, { recursive: true, force: true });
});

describe("DesktopAgentWorkspaceFiles", () => {
  it("事务内读取 upper，回滚只丢弃本次修改", async () => {
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path, "transactional");
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
    const first = await DesktopAgentWorkspaceFiles.open(workspace_path, "transactional");
    await put(first, "changes/items/updates.jsonl", "step-9");
    await first.commit();

    const second = await DesktopAgentWorkspaceFiles.open(workspace_path, "transactional");
    await put(second, "changes/items/updates.jsonl", "broken-step-10");
    await second.rollback();

    expect(
      fs.readFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "utf-8"),
    ).toBe("step-9");
  });

  it("scratch 删除和新写入组成合并视图，事务目录不可见也不可访问", async () => {
    fs.writeFileSync(path.join(workspace_path, "scratch", "old.txt"), "old");
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path, "transactional");
    await files.handle(
      new Request("lg-agent-workspace://workspace/files/scratch/old.txt", { method: "DELETE" }),
    );
    await put(files, "scratch/new.txt", "new");

    const listed = await files.handle(
      new Request("lg-agent-workspace://workspace/__list__?path=scratch"),
    );
    expect(await listed.json()).toEqual([{ name: "new.txt", type: "file" }]);
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

  it("只读 recipe 会话不创建事务，也拒绝写入", async () => {
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path, "readonly");

    expect(await files.read_recipe_source("query-items")).toBe("return args;");
    expect((await put(files, "changes/items/updates.jsonl", "changed")).status).toBe(403);
    expect(fs.existsSync(path.join(workspace_path, ".transactions"))).toBe(false);
  });

  it("contract 根结构损坏时拒绝建立文件会话", async () => {
    fs.writeFileSync(path.join(workspace_path, "contract.json"), "[]");

    await expect(DesktopAgentWorkspaceFiles.open(workspace_path, "transactional")).rejects.toThrow(
      "Workspace contract.json root is invalid.",
    );
  });

  it("提交安装失败会恢复基线并报告 preserved", async () => {
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path, "transactional");
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
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path, "transactional");
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
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path, "transactional");
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
      const files = await DesktopAgentWorkspaceFiles.open(workspace_path, "transactional");
      expect(await put(files, "scratch/link/secret.txt", "changed")).toHaveProperty("status", 204);

      await expect(files.commit()).rejects.toMatchObject({ workspacePreserved: true });
      expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf-8")).toBe("secret");
    } finally {
      fs.unlinkSync(link_path);
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("大只读文件不进入 upper，非法路径与非 scratch 删除被拒绝", async () => {
    fs.writeFileSync(
      path.join(workspace_path, "glossary", "large.bin"),
      Buffer.alloc(2 * 1024 * 1024),
    );
    const files = await DesktopAgentWorkspaceFiles.open(workspace_path, "transactional");
    await put(files, "changes/items/updates.jsonl", "changed");
    const transaction = fs.readdirSync(path.join(workspace_path, ".transactions"))[0];
    if (transaction === undefined) throw new Error("缺少事务目录");
    expect(
      fs.existsSync(path.join(workspace_path, ".transactions", transaction, "upper", "glossary")),
    ).toBe(false);
    expect((await put(files, "project_meta.json", "changed")).status).toBe(403);
    expect((await put(files, "items/entries.jsonl", "changed")).status).toBe(403);
    expect((await put(files, "scratch", "changed")).status).toBe(403);
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
