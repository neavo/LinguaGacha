import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppPathService } from "../app/app-path-service";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { AppError } from "../../shared/error";
import { create_provider_error } from "../network/provider-error";
import { ChatGPTCredentialStore } from "./chatgpt-credential-store";
import { ChatGPTAuthService } from "./chatgpt-auth-service";
import { chatgpt_oauth, type ChatGPTCredential } from "./chatgpt-oauth";
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
  await store.update(async (account) => {
    account.registration = {
      client_id: credential.clientId,
      subject: credential.subject,
      email: credential.email,
    };
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
  it("浏览器取消后发布正常账户状态，保留原连接且不发布错误", async () => {
    const completion = Promise.withResolvers<ChatGPTCredential>();
    vi.spyOn(oauth_protocol, "start_chatgpt_login").mockResolvedValue({
      url: "https://auth.openai.com/authorize",
      completion: completion.promise,
    });
    const finished = Promise.withResolvers<void>();
    const publish = vi.fn((_topic, payload) => {
      if (payload.snapshot.revision > 0) finished.resolve();
    });
    const auth = new ChatGPTAuthService(paths, new RuntimeOperationGate(), publish);
    services.push(auth);
    expect(await Promise.all([auth.login(), auth.login()])).toEqual([
      "https://auth.openai.com/authorize",
      "https://auth.openai.com/authorize",
    ]);
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
      if (payload.error) finished.resolve();
    });
    const auth = new ChatGPTAuthService(paths, new RuntimeOperationGate(), publish);
    services.push(auth);
    const started = await auth.login();
    expect(started).toBe("https://auth.openai.com/authorize");
    completion.reject(create_provider_error("Permission denied"));
    await finished.promise;
    expect(store.read_account().credential?.access).toBe("old-access");
    expect(publish).toHaveBeenLastCalledWith(
      "model.auth_changed",
      expect.objectContaining({
        error: { code: "model.provider_failed", details: { message: "Permission denied" } },
      }),
    );
    const success = Promise.withResolvers<void>();
    publish.mockImplementation((_topic, payload) => {
      if (payload.snapshot.revision > 0) success.resolve();
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

  it("退出等待刷新后撤销最新 refresh token，提交期间任务启动互斥", async () => {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    vi.spyOn(chatgpt_oauth, "refresh").mockImplementation(async (current) => {
      started.resolve();
      await finish.promise;
      return { ...current, access: "new", refresh: "new-refresh", expires: Date.now() + 3_600_000 };
    });
    const revoke = vi.spyOn(oauth_protocol, "revoke_chatgpt_session").mockResolvedValue();
    const gate = new RuntimeOperationGate();
    const auth = new ChatGPTAuthService(paths, gate, vi.fn());
    services.push(auth);
    const resolving = auth.resolve(auth.bind());
    await started.promise;
    const logout = auth.logout();
    try {
      expect(() => gate.begin_runtime("model_test")).toThrowError(
        expect.objectContaining({ code: "runtime.busy" }),
      );
    } finally {
      finish.resolve();
    }
    await resolving;
    expect(await logout).toMatchObject({
      snapshot: { connected: false },
    });
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({ refresh: "new-refresh" }),
      expect.any(AbortSignal),
    );
    expect(store.read_account()).toMatchObject({
      credential: null,
      registration: { client_id: "registered-client" },
    });
  });
  it("多个后端并发解析只刷新一次，刷新保留身份且重启读取新凭据", async () => {
    const refresh = vi.spyOn(chatgpt_oauth, "refresh").mockImplementation(async (current) => ({
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

  it("临时刷新失败保留连接，明确失效清除 token 并保留注册", async () => {
    const refresh = vi
      .spyOn(chatgpt_oauth, "refresh")
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
      registration: { client_id: "registered-client" },
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("取消一个等待者仍保存已轮换 token，旧任务拒绝新登录会话", async () => {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    vi.spyOn(chatgpt_oauth, "refresh").mockImplementation(async (current) => {
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
    const read = ChatGPTCredentialStore.prototype.read;
    vi.spyOn(ChatGPTCredentialStore.prototype, "read").mockImplementationOnce(async function (
      this: ChatGPTCredentialStore,
      provider,
    ) {
      const old = await read.call(this, provider);
      await store.update(async (account) => {
        account.credential = { ...credential, session_id: "session-two" };
      });
      return old;
    });
    await expect(auth.resolve("session-one")).rejects.toMatchObject({
      code: "model.auth_required",
    });
  });
});
