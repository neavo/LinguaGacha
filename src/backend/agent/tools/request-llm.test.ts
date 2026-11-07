import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { create_llm_requester, execute_llm_request, type WorkspaceLLMRequest } from "./request-llm";

it("按配置身份借用地址和凭据，原生请求体保持不变，执行内配置固定", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-llm-"));
  const file = path.join(temp.path, "request.json");
  const body = JSON.stringify({ model: "fixture-model", input: "hello", temperature: 0.3 });
  fs.writeFileSync(file, body);
  const selected = {
    id: "selected",
    api_url: "https://example.com/api/v3/responses",
    api_key: "fixture-secret\nsecond-key",
    model_id: "ignored",
  };
  const config = {
    models: [{ id: "other", api_url: "https://other.example", api_key: "other-key" }, selected],
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('{"output":[],"echoed":"fixture-secret"}'));
  const port = create_llm_requester(config, fetcher);
  selected.api_url = "https://changed.example";
  selected.api_key = "changed-key";
  const result = await execute_llm_request(
    { kind: "request_llm", config_id: "selected", api: "responses", body_file: file },
    new AbortController().signal,
    port,
  );
  expect(JSON.parse(result)).toEqual({ output: [], echoed: "[REDACTED]" });
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe("https://example.com/api/v3/responses");
  expect(init!.body).toBe(body);
  expect(init!.headers).toEqual({
    "Content-Type": "application/json",
    Authorization: "Bearer fixture-secret",
  });
  expect(init!.redirect).toBe("error");
});

it("拒绝无效契约、身份和请求体，不发出请求", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-llm-input-"));
  const file = path.join(temp.path, "request.json");
  const fetcher = vi.fn<typeof fetch>();
  const port = create_llm_requester(
    {
      models: [
        { id: "fixture", api_url: "https://example.com", api_key: "key" },
        { id: "oauth", api_url: "https://example.com", api_key: "key", auth_type: "oauth" },
      ],
    },
    fetcher,
  );
  const request: WorkspaceLLMRequest = {
    kind: "request_llm",
    config_id: "fixture",
    api: "responses",
    body_file: file,
  };
  const signal = new AbortController().signal;
  for (const invalid of [
    { ...request, api: "chat" },
    { ...request, api_key: "override" },
    { ...request, body_file: "" },
  ]) {
    await expect(execute_llm_request(invalid, signal, port)).rejects.toThrow("Invalid");
  }
  await expect(port({ ...request, config_id: "missing" }, signal)).rejects.toThrow("Configure");
  await expect(port({ ...request, config_id: "oauth" }, signal)).rejects.toThrow("API Key");
  for (const body of [
    "",
    "{",
    "[]",
    "{}",
    '{"model":" "}',
    '{"model":"m","stream":true}',
    '{"model":"m","background":true}',
  ]) {
    fs.writeFileSync(file, body);
    await expect(port(request, signal)).rejects.toThrow();
  }
  fs.truncateSync(file, 64_000_001);
  await expect(port(request, signal)).rejects.toThrow("64 MB");
  expect(fetcher).not.toHaveBeenCalled();
});

it("HTTP 与网络失败只返回脱敏错误，不重试", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-llm-error-"));
  const file = path.join(temp.path, "request.json");
  fs.writeFileSync(file, '{"model":"fixture"}');
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("fixture-secret", { status: 429 }))
    .mockRejectedValueOnce(new Error("network fixture-secret"));
  const port = create_llm_requester(
    { models: [{ id: "fixture", api_url: "https://example.com", api_key: "fixture-secret" }] },
    fetcher,
  );
  const request: WorkspaceLLMRequest = {
    kind: "request_llm",
    config_id: "fixture",
    api: "responses",
    body_file: file,
  };
  await expect(port(request, new AbortController().signal)).rejects.toThrow("HTTP 429");
  await expect(port(request, new AbortController().signal)).rejects.toThrow("network [REDACTED]");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("停止信号取消请求，调用等待响应流实际结算", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-llm-stop-"));
  const file = path.join(temp.path, "request.json");
  fs.writeFileSync(file, '{"model":"fixture"}');
  const entered = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  let received: AbortSignal | null | undefined;
  const port = create_llm_requester(
    { models: [{ id: "fixture", api_url: "https://example.com", api_key: "key" }] },
    async (_url, init) => {
      received = init?.signal;
      entered.resolve();
      await finished.promise;
      return new Response('{"status":"completed"}');
    },
  );
  const controller = new AbortController();
  let settled = false;
  const pending = port(
    { kind: "request_llm", config_id: "fixture", api: "responses", body_file: file },
    controller.signal,
  ).finally(() => {
    settled = true;
  });
  const rejection = expect(pending).rejects.toThrow("stopped");
  try {
    await entered.promise;
    controller.abort(new Error("stopped"));
    expect(received?.aborted).toBe(true);
    expect(settled).toBe(false);
  } finally {
    finished.resolve();
    await rejection;
  }
});
