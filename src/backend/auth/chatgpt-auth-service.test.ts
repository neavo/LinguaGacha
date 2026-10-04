import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppPathService } from "../app/app-path-service";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { AppError } from "../../shared/error";
import { create_provider_error } from "../network/provider-error";
import { default_native_fs } from "../../native/native-fs";
import { ChatGPTCredentialStore } from "./chatgpt-credential-store";
import { ChatGPTAuthService } from "./chatgpt-auth-service";
import type { ChatGPTCredential } from "./chatgpt-oauth";
import * as oauth_protocol from "./chatgpt-oauth";

let root: string;
let store: ChatGPTCredentialStore;
let paths: AppPathService;
const services: ChatGPTAuthService[] = [];
const credential: ChatGPTCredential = {
  type: "oauth",
  access: "old-access",
  refresh: "old-refresh",
  expires: 0,
  clientId: "registered-client",
  subject: "verified-subject",
  email: "test@example.test",
  scopes: ["chatgpt.tokens.use.direct"],
  session_id: "session-one",
};
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-auth-"));
  paths = new AppPathService({ appRoot: root, builtinRoot: root });
  store = new ChatGPTCredentialStore(paths.get_user_data_path("auth", "chatgpt.json"));
  await store.update((account) => {
    account.credential = { ...credential };
  });
});
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});
/** 每个实例加入统一清理，多个实例通过真实文件共享凭据。 */
function service(): ChatGPTAuthService {
  const result = new ChatGPTAuthService(paths, new RuntimeOperationGate(), vi.fn());
  services.push(result);
  return result;
}

describe("ChatGPT 账户共享凭据", () => {
  it("退出和关闭不等待远端撤销，撤销失败不改变本地结果", async () => {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let revoke_signal: AbortSignal | undefined;
    vi.spyOn(oauth_protocol, "revoke_chatgpt_session").mockImplementation(
      async (_credential, signal) => {
        revoke_signal = signal;
        started.resolve();
        await finish.promise;
      },
    );
    const auth = service();
    let completed = false;
    const logout = auth.logout().then(() => {
      completed = true;
    });
    try {
      await started.promise;
      await vi.waitFor(() => {
        expect(completed).toBe(true);
        expect(auth.snapshot().connected).toBe(false);
      });
      await auth.dispose();
      expect(revoke_signal?.aborted).toBe(true);
      const before = auth.snapshot();
      finish.reject(new Error("offline"));
      await finish.promise.catch(() => undefined);
      expect(auth.snapshot()).toEqual(before);
    } finally {
      finish.resolve();
      await logout;
    }
  });

  it("本地退出写入失败保留连接并报告错误，不发送远端撤销", async () => {
    const auth = service();
    const revoke = vi.spyOn(oauth_protocol, "revoke_chatgpt_session").mockResolvedValue();
    vi.spyOn(default_native_fs, "write_file_atomic").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    await expect(auth.logout()).rejects.toThrow("disk full");
    expect(auth.snapshot().connected).toBe(true);
    expect(revoke).not.toHaveBeenCalled();
    await auth.logout();
    expect(auth.snapshot().connected).toBe(false);
  });

  it("退出后的迟到刷新不会恢复已清除的连接", async () => {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    vi.spyOn(oauth_protocol, "refresh_chatgpt_credential").mockImplementation(async (current) => {
      started.resolve();
      await finish.promise;
      return { ...current, access: "late-access", refresh: "late-refresh" };
    });
    vi.spyOn(oauth_protocol, "revoke_chatgpt_session").mockResolvedValue();
    const auth = service();
    const rejected = expect(auth.resolve(auth.bind())).rejects.toMatchObject({
      code: "model.auth_required",
    });
    await started.promise;
    try {
      await auth.logout();
    } finally {
      finish.resolve();
      await rejected;
    }
    expect(store.read_account().credential).toBeNull();
    expect(auth.snapshot().connected).toBe(false);
  });
  it.each(["logout", "expired"] as const)(
    "%s 后全新授权可换账号并保留安装标识",
    async (scenario) => {
      const auth = service();
      const host_id = store.read_account().host_id;
      if (scenario === "logout") {
        vi.spyOn(oauth_protocol, "revoke_chatgpt_session").mockResolvedValue();
        await auth.logout();
      } else {
        vi.spyOn(oauth_protocol, "refresh_chatgpt_credential").mockRejectedValue(
          create_provider_error("expired", 400, { auth_invalid: true }),
        );
        await expect(auth.resolve(auth.bind())).rejects.toBeDefined();
      }
      expect(auth.snapshot().connected).toBe(false);
      const start = vi.spyOn(oauth_protocol, "start_chatgpt_login").mockResolvedValue({
        url: "https://auth.openai.com/authorize",
        completion: Promise.resolve({
          ...credential,
          clientId: "account-b-client",
          subject: "account-b",
          session_id: "account-b-session",
        }),
      });
      const login = await auth.login();
      await vi.waitFor(() =>
        expect(auth.snapshot().login).toEqual({ id: login.id, status: "succeeded" }),
      );
      expect(start).toHaveBeenCalledWith({ host_id, signal: expect.any(AbortSignal) });
      expect(store.read_account()).toMatchObject({
        host_id,
        login_id: null,
        credential: { subject: "account-b" },
      });
      expect(auth.bind()).toBe("account-b-session");
    },
  );

  it("取消后重开生成新授权，旧取消请求无法影响新授权", async () => {
    const signals: AbortSignal[] = [];
    vi.spyOn(oauth_protocol, "start_chatgpt_login").mockImplementation(async ({ signal }) => {
      signals.push(signal);
      return {
        url: `https://auth.openai.com/authorize?attempt=${signals.length}`,
        completion: new Promise<ChatGPTCredential>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new AppError("runtime.cancelled")), {
            once: true,
          });
        }),
      };
    });
    const auth = service();
    const first = await auth.login();
    expect(await auth.cancel_login(first.id)).toMatchObject({
      snapshot: { login: { id: first.id, status: "cancelled" } },
    });
    expect(store.read_account().login_id).toBeNull();
    const second = await auth.login();
    expect(second.id).not.toBe(first.id);
    expect(second.url).not.toBe(first.url);
    await auth.cancel_login(first.id);
    expect(signals[1]?.aborted).toBe(false);
    expect(store.read_account().login_id).toBe(second.id);
    await auth.cancel_login(second.id);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("另一个进程开始授权后，旧回调及清理不能覆盖新归属", async () => {
    const completion = Promise.withResolvers<ChatGPTCredential>();
    vi.spyOn(oauth_protocol, "start_chatgpt_login").mockResolvedValue({
      url: "https://auth.openai.com/authorize",
      completion: completion.promise,
    });
    const auth = service();
    const login = await auth.login();
    await store.update((account) => {
      account.login_id = "other-process";
    });
    completion.resolve({ ...credential, session_id: "late-session" });
    await vi.waitFor(() =>
      expect(auth.snapshot().login).toEqual({ id: login.id, status: "cancelled" }),
    );
    expect(store.read_account()).toMatchObject({
      login_id: "other-process",
      credential: { session_id: "session-one" },
    });
  });

  it("启动失败清理授权归属，下一次请求能够重新开始", async () => {
    vi.spyOn(oauth_protocol, "start_chatgpt_login").mockRejectedValue(new Error("listener failed"));
    const auth = service();
    await expect(auth.login()).rejects.toMatchObject({ message: "listener failed" });
    expect(store.read_account().login_id).toBeNull();
    const first_id = auth.snapshot().login?.id;
    await expect(auth.login()).rejects.toBeDefined();
    expect(auth.snapshot().login?.id).not.toBe(first_id);
  });

  it("授权超时关闭真实监听，保留失败快照供重连恢复", async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const auth = service();
    const login = await auth.login();
    const callback = new URL(login.url).searchParams.get("redirect_uri")!;
    timeout.abort();
    await vi.waitFor(() =>
      expect(auth.snapshot().login).toMatchObject({
        id: login.id,
        status: "failed",
        error: {
          code: "model.provider_failed",
          details: { message: "ChatGPT sign-in timed out." },
        },
      }),
    );
    await expect(fetch(callback)).rejects.toBeDefined();
    expect(store.read_account().login_id).toBeNull();
  });
  it("浏览器取消后发布正常账户状态，保留原连接且不发布错误", async () => {
    const completion = Promise.withResolvers<ChatGPTCredential>();
    vi.spyOn(oauth_protocol, "start_chatgpt_login").mockResolvedValue({
      url: "https://auth.openai.com/authorize",
      completion: completion.promise,
    });
    const finished = Promise.withResolvers<void>();
    const publish = vi.fn((_topic, payload) => {
      if (payload.snapshot.login?.status === "cancelled") finished.resolve();
    });
    const auth = new ChatGPTAuthService(paths, new RuntimeOperationGate(), publish);
    services.push(auth);
    const [first, second] = await Promise.all([auth.login(), auth.login()]);
    expect(first.id).toBe(second.id);
    expect(first.url).toBe("https://auth.openai.com/authorize");
    expect(oauth_protocol.start_chatgpt_login).toHaveBeenCalledOnce();
    completion.reject(new AppError("runtime.cancelled"));
    await finished.promise;
    const payload = publish.mock.calls.at(-1)?.[1];
    expect(payload).not.toHaveProperty("error");
    expect(payload.snapshot).toMatchObject({ connected: true });
    expect(store.read_account().credential?.refresh).toBe("old-refresh");
  });
  it("登录授权失败通过事件报告并保留旧连接，成功后才替换凭据", async () => {
    const completion = Promise.withResolvers<ChatGPTCredential>();
    vi.spyOn(oauth_protocol, "start_chatgpt_login").mockResolvedValue({
      url: "https://auth.openai.com/authorize",
      completion: completion.promise,
    });
    const finished = Promise.withResolvers<void>();
    const publish = vi.fn((_topic, payload) => {
      if (payload.snapshot.login?.status === "failed") finished.resolve();
    });
    const auth = new ChatGPTAuthService(paths, new RuntimeOperationGate(), publish);
    services.push(auth);
    const started = await auth.login();
    expect(started.url).toBe("https://auth.openai.com/authorize");
    completion.reject(create_provider_error("Permission denied"));
    await finished.promise;
    expect(store.read_account().credential?.access).toBe("old-access");
    expect(publish).toHaveBeenLastCalledWith(
      "model.auth_changed",
      expect.objectContaining({
        snapshot: expect.objectContaining({
          login: {
            id: started.id,
            status: "failed",
            error: { code: "model.provider_failed", details: { message: "Permission denied" } },
          },
        }),
      }),
    );
    const success = Promise.withResolvers<void>();
    publish.mockImplementation((_topic, payload) => {
      if (payload.snapshot.login?.status === "succeeded") success.resolve();
    });
    vi.mocked(oauth_protocol.start_chatgpt_login).mockResolvedValue({
      url: "https://auth.openai.com/authorize",
      completion: Promise.resolve({
        ...credential,
        access: "signed-in",
        session_id: "new-session",
      }),
    });
    await auth.login();
    await success.promise;
    expect(auth.bind()).toBe("new-session");
    expect(store.read_account().credential?.access).toBe("signed-in");
  });

  it.each(["success", "invalid", "network"] as const)(
    "退出不等待刷新，旧刷新 %s 不能影响新登录",
    async (outcome) => {
      const started = Promise.withResolvers<void>();
      const finish = Promise.withResolvers<void>();
      vi.spyOn(oauth_protocol, "refresh_chatgpt_credential").mockImplementation(async (current) => {
        if (current.session_id === "session-two")
          return { ...current, access: "account-b", expires: Date.now() + 3_600_000 };
        started.resolve();
        await finish.promise;
        if (outcome === "invalid")
          throw create_provider_error("expired", 400, { auth_invalid: true });
        if (outcome === "network") throw new Error("offline");
        return {
          ...current,
          access: "rotated",
          refresh: "rotated-refresh",
          expires: Date.now() + 3_600_000,
        };
      });
      const revoke = vi.spyOn(oauth_protocol, "revoke_chatgpt_session").mockResolvedValue();
      const gate = new RuntimeOperationGate();
      const auth = new ChatGPTAuthService(paths, gate, vi.fn());
      services.push(auth);
      const resolving = auth.resolve(auth.bind());
      const rejected = expect(resolving).rejects.toBeDefined();
      await started.promise;
      try {
        expect(await auth.logout()).toMatchObject({ snapshot: { connected: false } });
        const lease = gate.begin_runtime("model_test");
        gate.finish_runtime(lease);
        expect(store.read_account().credential).toBeNull();
        await store.update((account) => {
          account.credential = { ...credential, session_id: "session-two" };
        });
        // 新会话即使也需要刷新，仍不等待旧会话的网络请求。
        expect(await auth.resolve("session-two")).toEqual({ apiKey: "account-b" });
      } finally {
        finish.resolve();
        await rejected;
      }
      expect(store.read_account().credential).toMatchObject({
        session_id: "session-two",
        access: "account-b",
      });
      expect(revoke).toHaveBeenCalledWith(
        expect.objectContaining({ refresh: "old-refresh" }),
        expect.any(AbortSignal),
      );
      if (outcome === "success")
        expect(revoke).toHaveBeenCalledWith(
          expect.objectContaining({ refresh: "rotated-refresh" }),
          expect.any(AbortSignal),
        );
    },
  );
  it("多个后端并发解析只刷新一次，刷新保留身份且重启读取新凭据", async () => {
    const refresh = vi
      .spyOn(oauth_protocol, "refresh_chatgpt_credential")
      .mockImplementation(async (current) => ({
        ...current,
        access: "new-access",
        refresh: "new-refresh",
        expires: Date.now() + 3_600_000,
      }));
    const first = service();
    const second = service();
    const results = await Promise.all([
      first.resolve(first.bind()),
      second.resolve(second.bind()),
      first.resolve(first.bind()),
    ]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(results.map((result) => result.apiKey)).toEqual([
      "new-access",
      "new-access",
      "new-access",
    ]);
    expect(store.read_account().credential).toMatchObject({
      refresh: "new-refresh",
      subject: credential.subject,
      clientId: credential.clientId,
    });
    expect(await service().resolve("session-one")).toEqual({ apiKey: "new-access" });
    expect(JSON.stringify(first.snapshot())).not.toContain("new-refresh");
  });

  it("临时刷新失败保留连接，明确失效清除凭据", async () => {
    const refresh = vi
      .spyOn(oauth_protocol, "refresh_chatgpt_credential")
      .mockRejectedValueOnce(new Error("network failed"))
      .mockRejectedValueOnce(
        create_provider_error("Session expired.", 400, { auth_invalid: true, retryable: false }),
      );
    const auth = service();
    await expect(auth.resolve(auth.bind())).rejects.toMatchObject({
      code: "model.provider_failed",
    });
    expect(store.read_account().credential?.refresh).toBe("old-refresh");
    await expect(auth.resolve(auth.bind())).rejects.toMatchObject({
      code: "model.provider_failed",
      message: "Session expired.",
    });
    expect(store.read_account()).toMatchObject({
      credential: null,
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("取消一个等待者仍保存已轮换 token，旧任务拒绝新登录会话", async () => {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    vi.spyOn(oauth_protocol, "refresh_chatgpt_credential").mockImplementation(async (current) => {
      started.resolve();
      await finish.promise;
      return {
        ...current,
        access: "rotated",
        refresh: "rotated-refresh",
        expires: Date.now() + 3_600_000,
      };
    });
    const auth = service();
    const controller = new AbortController();
    const pending = auth.resolve(auth.bind(), controller.signal);
    const rejected = expect(pending).rejects.toBeDefined();
    await started.promise;
    controller.abort();
    finish.resolve();
    await rejected;
    await auth.resolve("session-one"); // 取消等待者不等待落盘，其余请求继续等同一次刷新完成。
    expect(store.read_account().credential?.refresh).toBe("rotated-refresh");
    await store.update((account) => {
      account.credential = { ...credential, session_id: "session-two" };
    });
    await expect(auth.resolve("session-one")).rejects.toMatchObject({
      code: "model.auth_required",
    });
  });
});
