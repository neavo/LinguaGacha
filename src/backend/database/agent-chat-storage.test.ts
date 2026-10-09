import { NodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { SqliteExecutor } from "@earendil-works/pi-durable/storage/sqlite";
import { ProjectWriteStore } from "../project/project-write-store";
import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import { ACTIVE_AGENT_CHAT_KEY } from "./agent-chat-storage";
import os from "node:os";
import path from "node:path";
import { Harness, createRegistry, defineDoc } from "@earendil-works/pi-durable";
import { createModels } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ProjectDatabase } from "./database-operations";
import { uploaded_file } from "../../test/agent-upload-fixture";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("SDK 与工程并发提交、失败回滚，关闭后只复制 lg 即可恢复登记和历史", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-agent-db-"));
  roots.push(root);
  const file = path.join(root, "project.lg");
  const database = new ProjectDatabase();
  database.create_project(file, "测试");
  const store = database.open_agent_store(file);
  await store.create("-t75szF5");
  const state = defineDoc({
    kind: "test.counter",
    version: 1,
    scope: "session",
    initial: () => ({ count: 0 }),
  });
  const harness = await Harness.open(
    await store.open_storage(),
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  );
  const conversation = await harness.root(BACKGROUND_CONTEXT);
  try {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const transaction = NodeSqliteDatabase.prototype.transaction;
    // 在真实 SDK SQL 事务内暂停，确保进度写入与回滚实际交错。
    vi.spyOn(NodeSqliteDatabase.prototype, "transaction").mockImplementationOnce(function <T>(
      this: NodeSqliteDatabase,
      callback: (tx: SqliteExecutor) => Promise<T>,
    ): Promise<T> {
      return transaction.call(this, async (tx) => {
        await callback(tx);
        entered.resolve();
        await release.promise;
        throw new Error("SDK rollback");
      }) as Promise<T>;
    });
    const sdk_write = store.save_upload("-t75szF5", uploaded_file("rolled-back"));
    const rejected = expect(sdk_write).rejects.toThrow("SDK rollback");
    await entered.promise;
    const writes = new ProjectWriteStore(database, () => undefined, null);
    const progress = writes.update_task_progress_meta({
      projectPath: file,
      meta: { translation_extras: { line: 123 } },
    });
    release.resolve();
    await rejected;
    await progress;
    expect(database.get_all_meta(file)).toHaveProperty("translation_extras", { line: 123 });
    expect((await store.read())?.data.uploads).toEqual([]);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        Promise.all([
          harness.commit(async (tx) => {
            (await tx.doc(state)).count++;
            await tx.appendEntry(conversation.id, { kind: "test.entry", data: i });
          }, BACKGROUND_CONTEXT),
          database.transaction(file, () => database.set_meta(file, "progress", i)),
          store.save_upload("-t75szF5", uploaded_file(String(i))),
        ]),
      ),
    );
    await expect(
      database.transaction(file, () => {
        database.set_meta(file, "rolled_back", true);
        throw new Error("reject");
      }),
    ).rejects.toThrow();
    expect(database.get_all_meta(file)).not.toHaveProperty("rolled_back");
    expect((await store.read())?.data.uploads).toHaveLength(10);
    expect(await harness.snapshot(state, BACKGROUND_CONTEXT)).toEqual({ count: 10 });
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
    await store.close();
    database.close();
  }
  const copy = path.join(root, "copy.lg");
  fs.copyFileSync(file, copy);
  const reopened = new ProjectDatabase();
  const restored = reopened.open_agent_store(copy);
  const sdk = await Harness.open(
    await restored.open_storage(),
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  );
  expect((await restored.read())?.id).toBe("-t75szF5");
  expect(await sdk.snapshot(state, BACKGROUND_CONTEXT)).toEqual({ count: 10 });
  await sdk.close(BACKGROUND_CONTEXT);
  await restored.reset();
  expect(await restored.read()).toBeNull();
  expect(reopened.get_all_meta(copy)).toMatchObject({ name: "测试" });
  await restored.close();
  reopened.close();
});

it("读取工程时拒绝无效激活指针和缺失登记", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-agent-invalid-id-"));
  roots.push(root);
  const file = path.join(root, "project.lg");
  const database = new ProjectDatabase();
  database.create_project(file, "测试");
  const store = database.open_agent_store(file);
  try {
    await store.create("-t75szF5");
    for (const id of [null, 1, "", "missing"]) {
      database.set_meta(file, ACTIVE_AGENT_CHAT_KEY, id);
      await expect(store.read()).rejects.toMatchObject({ code: "file.invalid_structure" });
    }
  } finally {
    await store.close();
    database.close();
  }
});
