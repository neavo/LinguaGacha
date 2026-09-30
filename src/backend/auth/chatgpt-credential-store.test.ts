import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { default_native_fs } from "../../native/native-fs";
import { ChatGPTCredentialStore } from "./chatgpt-credential-store";

describe("ChatGPT 凭据文件", () => {
  it("另一个进程持锁时等待，取得锁后读取其最新提交", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-auth-lock-"));
    const file = path.join(root, "chatgpt.json");
    const store = new ChatGPTCredentialStore(file);
    await store.update(async () => undefined);
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import fs from 'node:fs';
      import lockfile from 'proper-lockfile';
      const file = process.argv[1];
      const release = await lockfile.lock(file, {realpath:false});
      process.stdout.write('locked');
      process.stdin.once('data', async () => {
        const account = JSON.parse(fs.readFileSync(file, 'utf8'));
        account.registration = {client_id:'other-process', subject:'sub', email:'test@example.test'};
        fs.writeFileSync(file, JSON.stringify(account));
        await release();
        process.exit(0);
      });
    `,
        file,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const exited = once(child, "exit");
    try {
      await once(child.stdout, "data", { signal: AbortSignal.timeout(5_000) });
      const result = store.update(async (account) => account.registration?.client_id);
      child.stdin.write("release");
      expect(await result).toBe("other-process");
      expect((await exited)[0]).toBe(0);
    } finally {
      if (child.exitCode === null) {
        child.kill();
        await exited;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("保存失败传播并释放文件锁，后续写入可继续", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-auth-write-"));
    const store = new ChatGPTCredentialStore(path.join(root, "chatgpt.json"));
    try {
      await store.update(async () => undefined);
      const write = vi.spyOn(default_native_fs, "write_file_atomic").mockImplementationOnce(() => {
        throw new Error("disk full");
      });
      await expect(
        store.update(async (account) => {
          account.login_id = "candidate";
        }),
      ).rejects.toThrow("disk full");
      write.mockRestore();
      await store.update(async (account) => {
        account.login_id = "next-attempt";
      });
      expect(store.read_account().login_id).toBe("next-attempt");
    } finally {
      vi.restoreAllMocks();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
