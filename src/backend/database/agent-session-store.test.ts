import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
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
  await store.create("session1");
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
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        Promise.all([
          harness.commit(async (tx) => {
            (await tx.doc(state)).count++;
            await tx.appendEntry(conversation.id, { kind: "test.entry", data: i });
          }, BACKGROUND_CONTEXT),
          database.transaction(file, () => database.set_meta(file, "progress", i)),
          store.save_upload("session1", uploaded_file(String(i))),
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
  expect((await restored.read())?.id).toBe("session1");
  expect(await sdk.snapshot(state, BACKGROUND_CONTEXT)).toEqual({ count: 10 });
  await sdk.close(BACKGROUND_CONTEXT);
  await restored.reset();
  expect(await restored.read()).toBeNull();
  expect(reopened.get_all_meta(copy)).toMatchObject({ name: "测试" });
  await restored.close();
  reopened.close();
});
