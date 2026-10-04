import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { default_native_fs } from "../../native/native-fs";
import { ChatGPTCredentialStore } from "./chatgpt-credential-store";

describe("ChatGPT 凭据文件", () => {
  it("旧注册绑定不参与读取，保存时移除且保留当前凭据和安装标识", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-auth-old-"));
    const file = path.join(root, "chatgpt.json");
    const account = {
      host_id: "fixture-host",
      credential: { type: "oauth", clientId: "current-client", access: "current-token" },
      login_id: null,
    };
    fs.writeFileSync(
      file,
      JSON.stringify({ ...account, registration: { client_id: "old-client" } }),
    );
    try {
      const store = new ChatGPTCredentialStore(file);
      expect(store.read_account()).toEqual(account);
      await store.update(() => undefined);
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(account);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it.each(["account", "refresh"] as const)(
    "%s 锁跨进程串行，刷新锁不阻塞账户写入和其他会话",
    async (kind) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-auth-lock-"));
      const file = path.join(root, "chatgpt.json");
      const store = new ChatGPTCredentialStore(file);
      await store.update(() => undefined);
      const session_id = "fixture-session";
      const target =
        kind === "account"
          ? file
          : `${file}.refresh-${createHash("sha256").update(session_id).digest("hex")}`;
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
      import fs from 'node:fs';
      import lockfile from 'proper-lockfile';
      const file = process.argv[1];
      const release = await lockfile.lock(process.argv[2], {realpath:false});
      process.stdout.write('locked');
      process.stdin.once('data', async () => {
        const account = JSON.parse(fs.readFileSync(file, 'utf8'));
        account.login_id = 'other-process';
        fs.writeFileSync(file, JSON.stringify(account));
        await release();
        process.exit(0);
      });
    `,
          file,
          target,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const exited = once(child, "exit");
      try {
        await once(child.stdout, "data", { signal: AbortSignal.timeout(5_000) });
        let entered = false;
        const result =
          kind === "account"
            ? store.update((account) => account.login_id)
            : store.with_refresh_lock(session_id, async () => {
                entered = true;
                return store.read_account().login_id;
              });
        if (kind === "refresh") {
          await store.update((account) => {
            account.login_id = "local-write";
          });
          expect(
            await store.with_refresh_lock("new-session", async () => store.read_account().login_id),
          ).toBe("local-write");
          expect(entered).toBe(false);
        }
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
    },
  );

  it("保存失败传播并释放文件锁，后续写入可继续", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-auth-write-"));
    const store = new ChatGPTCredentialStore(path.join(root, "chatgpt.json"));
    try {
      await store.update(() => undefined);
      const write = vi.spyOn(default_native_fs, "write_file_atomic").mockImplementationOnce(() => {
        throw new Error("disk full");
      });
      await expect(
        store.update((account) => {
          account.login_id = "candidate";
        }),
      ).rejects.toThrow("disk full");
      write.mockRestore();
      await store.update((account) => {
        account.login_id = "next-attempt";
      });
      expect(store.read_account().login_id).toBe("next-attempt");
    } finally {
      vi.restoreAllMocks();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
