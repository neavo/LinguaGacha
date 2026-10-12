import { DatabaseSync } from "node:sqlite";
import { NodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";
import { expect, it } from "vitest";
import { AgentDatabaseAccess } from "./agent-database-access";

it("关闭等待已受理批次，拒绝新访问及作用域结束后逃逸的异步访问", async () => {
  using connection = new DatabaseSync(":memory:");
  connection.exec("CREATE TABLE records (value TEXT)");
  const sqlite = new NodeSqliteDatabase(connection);
  const access = new AgentDatabaseAccess((callback) => callback(sqlite));
  await access.run("INSERT INTO records VALUES (?)", "saved");
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const escaped = Promise.withResolvers<void>();
  let late: Promise<void> | undefined;
  const batch = access.read_batch(async () => {
    late = escaped.promise.then(() => access.run("INSERT INTO records VALUES (?)", "late"));
    entered.resolve();
    await release.promise;
    return access.get<{ value: string }>("SELECT value FROM records");
  });
  try {
    await entered.promise;
    let closed = false;
    const closing = access.close().then(() => {
      closed = true;
    });
    await expect(access.get("SELECT value FROM records")).rejects.toMatchObject({
      code: "runtime.cancelled",
    });
    expect(closed).toBe(false);
    release.resolve();
    expect(await batch).toEqual({ value: "saved" });
    await closing;
    const rejected = expect(late).rejects.toMatchObject({ code: "runtime.cancelled" });
    escaped.resolve();
    await rejected;
    expect(connection.prepare("SELECT value FROM records").all()).toEqual([{ value: "saved" }]);
  } finally {
    release.resolve();
    escaped.resolve();
    await Promise.allSettled([batch, late]);
    await access.close();
  }
});
