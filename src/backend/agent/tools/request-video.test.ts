import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { create_video_requester, execute_video_request } from "./request-video";

it("凭据留在宿主，请求固定视频参数，原始响应脱敏", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-video-"));
  const file = path.join(temp.path, "segment.mp4");
  fs.writeFileSync(file, "video fixture");
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: [], echoed: "fixture-secret" })),
    );
  const port = create_video_requester(
    () => ({
      models: [
        {
          id: "preset-volcengine",
          api_url: "https://example.com/api/v3/responses",
          api_key: "fixture-secret",
          model_id: "ignored",
        },
      ],
    }),
    fetcher,
  );
  const result = await execute_video_request(
    { kind: "request_video", file, prompt: "字幕" },
    new AbortController().signal,
    port,
  );
  expect(result).not.toContain("fixture-secret");
  expect(result).toContain("[REDACTED]");
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe("https://example.com/api/v3/responses");
  expect(JSON.parse(String(init!.body))).toMatchObject({
    model: "doubao-seed-2-1-lite-260915",
    reasoning: { effort: "low" },
    max_output_tokens: 32768,
    input: [
      {
        content: [
          { type: "input_video", fps: 1 },
          { type: "input_text", text: "字幕" },
        ],
      },
    ],
  });
  expect(init!.headers).toMatchObject({ Authorization: "Bearer fixture-secret" });
  await expect(
    execute_video_request(
      { kind: "request_video", file, prompt: "字幕", api_key: "override" },
      new AbortController().signal,
      port,
    ),
  ).rejects.toThrow("Invalid");
  expect(fetcher).toHaveBeenCalledTimes(1);
  fs.truncateSync(file, 50_000_000);
  await expect(
    port({ kind: "request_video", file, prompt: "字幕" }, new AbortController().signal),
  ).rejects.toThrow("50 MB");
  fs.truncateSync(file, 0);
  await expect(
    port({ kind: "request_video", file, prompt: "字幕" }, new AbortController().signal),
  ).rejects.toThrow("nonempty");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("停止信号取消请求，调用等待响应流实际结算", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-video-stop-"));
  const file = path.join(temp.path, "segment.mp4");
  fs.writeFileSync(file, "media");
  const entered = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  let received: AbortSignal | null | undefined;
  const port = create_video_requester(
    () => ({
      models: [{ id: "preset-volcengine", api_url: "https://example.com", api_key: "key" }],
    }),
    async (_url, init) => {
      received = init?.signal;
      entered.resolve();
      await finished.promise;
      return new Response('{"status":"completed"}');
    },
  );
  const controller = new AbortController();
  let settled = false;
  const pending = port({ kind: "request_video", file, prompt: "字幕" }, controller.signal).finally(
    () => {
      settled = true;
    },
  );
  const rejection = expect(pending).rejects.toThrow("stopped");
  await entered.promise;
  controller.abort(new Error("stopped"));
  expect(received?.aborted).toBe(true);
  expect(settled).toBe(false);
  finished.resolve();
  await rejection;
});
