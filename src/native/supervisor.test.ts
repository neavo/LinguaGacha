import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
import { Supervisor } from "./supervisor";

it.each([
  { label: "取消", fault: "none" },
  { label: "监管故障后取消", fault: "before" },
  { label: "取消后监管故障", fault: "after" },
])("$label 等待监管退出，保留首个失败原因", async ({ fault }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-supervisor-acquire-"));
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  const started = Promise.withResolvers<void>();
  spawn.mockImplementation(() => {
    started.resolve();
    return child;
  });
  const controller = new AbortController();
  const reason = new Error("cancel lease acquisition");
  let settled = false;
  const pending = Supervisor.acquire(root, path.join(root, "node.lock"), controller.signal).catch(
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  try {
    await started.promise;
    if (fault === "before") {
      child.stdout.write(`${JSON.stringify({ type: "fault", message: "lease failure" })}\n`);
      await Promise.resolve();
    }
    controller.abort(reason);
    if (fault === "after")
      child.stdout.write(`${JSON.stringify({ type: "fault", message: "lease failure" })}\n`);
    await Promise.resolve();
    expect(child.stdin.writableEnded).toBe(true);
    expect(settled).toBe(false);
    child.emit("close", 0);
    if (fault === "before") expect(await pending).toMatchObject({ message: "lease failure" });
    else expect(await pending).toBe(reason);
  } finally {
    child.emit("close", 0);
    await pending;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
