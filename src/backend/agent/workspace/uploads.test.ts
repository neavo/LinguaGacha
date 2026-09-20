import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { AgentUploadStore } from "./uploads";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
/** 每个场景使用独立目录，测试结束后统一回收。 */
function store(): { root: string; uploads: AgentUploadStore } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-uploads-"));
  roots.push(root);
  return { root, uploads: new AgentUploadStore(root, new NativeFs()) };
}
/** 用指定分块模拟上传请求体。 */
function stream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}

it("任意字节和空文件原样保存，清理名称并隔离同名上传", async () => {
  const { root, uploads } = store();
  const bytes = Uint8Array.from([0, 255, 128, 1, 2]);
  const first = await uploads.upload(
    "参考 图(最终).zip",
    stream(bytes.subarray(0, 2), bytes.subarray(2)),
    new AbortController().signal,
  );
  const second = await uploads.upload("参考 图(最终).zip", stream(), new AbortController().signal);
  expect(first).toMatchObject({ name: "参考 图(最终).zip", size: 5, imageMimeType: null });
  expect(first.path).toMatch(/^uploads\/[^/\\]+\.zip$/u);
  expect(second.path).not.toBe(first.path);
  expect(fs.readFileSync(path.join(root, first.path))).toEqual(Buffer.from(bytes));
  expect(fs.statSync(path.join(root, second.path)).size).toBe(0);
  expect(() => uploads.get("missing")).toThrow();
  await uploads.clear();
  expect(() => uploads.get(first.uploadId)).toThrow();
  expect(fs.existsSync(path.join(root, "uploads"))).toBe(false);
});

it("图片按跨分块文件头识别，上传保留原字节", async () => {
  const { uploads } = store();
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 12]);
  const file = await uploads.upload(
    "no-extension",
    stream(bytes.subarray(0, 3), bytes.subarray(3)),
    new AbortController().signal,
  );
  expect(file.imageMimeType).toBe("image/png");
  expect(uploads.read_image(file.uploadId)).toEqual(Buffer.from(bytes));
});

it("重置取消等待中的读取，清理半成品且旧身份不能进入新会话", async () => {
  const { root, uploads } = store();
  let cancelled = false;
  const pending = uploads.upload(
    "late.bin",
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    new AbortController().signal,
  );
  const rejected = expect(pending).rejects.toMatchObject({ code: "runtime.cancelled" });
  await uploads.clear();
  await rejected;
  expect(cancelled).toBe(true);
  expect(fs.existsSync(path.join(root, "uploads"))).toBe(false);
  const next = await uploads.upload(
    "next.bin",
    stream(Uint8Array.of(9)),
    new AbortController().signal,
  );
  expect(uploads.get(next.uploadId).size).toBe(1);
});
