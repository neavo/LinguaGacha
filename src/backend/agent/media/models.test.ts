import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, inject, it, vi } from "vitest";
import { download_model, type MediaModel } from "./models";

const CONTENT = Buffer.from(
  Array.from({ length: 3 * 1024 * 1024 }, (_, index) => (index * 31) % 251),
);
const CUT = 1024 * 1024; // `cut` 镜像每次只发出这么多字节就断开连接。
const WRONG = Buffer.alloc(CONTENT.length, 7);

type Behavior = "ok" | "missing" | "wrong" | "cut";
const behaviors = new Map<string, Behavior>(); // 镜像名到响应方式。
const ranges: string[] = []; // 收到的 Range 起点，按镜像记录。
let server: http.Server;
let base = "";
let root = "";

/** 支持 Range 的本地镜像。 */
beforeAll(async () => {
  server = http.createServer((request, response) => {
    const mirror = request.url!.split("/")[1]!;
    const behavior = behaviors.get(mirror) ?? "missing";
    if (behavior === "missing") return void response.writeHead(404).end();
    const body = behavior === "wrong" ? WRONG : CONTENT;
    const start = Number(/bytes=(\d+)-/u.exec(request.headers.range ?? "")?.[1] ?? 0);
    ranges.push(`${mirror}:${start}`);
    response.writeHead(start ? 206 : 200, {
      "accept-ranges": "bytes",
      "content-length": body.length - start,
      ...(start ? { "content-range": `bytes ${start}-${body.length - 1}/${body.length}` } : {}),
    });
    const chunk = body.subarray(start, behavior === "cut" ? start + CUT : body.length);
    if (behavior === "cut") response.write(chunk, () => response.destroy());
    else response.end(chunk);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lg-media-models-"));
  behaviors.clear();
  ranges.length = 0;
  const runtime = inject("workspaceRuntimeDirectory");
  const aria2 = path.join(runtime, "bin", `${process.platform}-${process.arch}`, "aria2");
  vi.stubEnv("PATH", [aria2, process.env.PATH].join(path.delimiter));
  for (const name of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
  ])
    vi.stubEnv(name, "");
});

afterEach(() => rm(root, { recursive: true, force: true }));

const model = (...mirrors: string[]): MediaModel => ({
  file: "nested/model.onnx",
  size: CONTENT.length,
  sha256: createHash("sha256").update(CONTENT).digest("hex"),
  urls: mirrors.map((mirror) => `${base}/${mirror}/model.onnx`),
});
const target = () => path.join(root, "models", "nested", "model.onnx");
const leftovers = async () =>
  (await readdir(path.dirname(target()))).filter((name) => name !== "model.onnx");
const download = (value: MediaModel) =>
  download_model(path.join(root, "models"), path.join(root, "stats.txt"), value);

it("downloads from the reachable mirror and publishes only verified content", async () => {
  behaviors.set("a", "missing").set("b", "ok");
  await download(model("a", "b"));
  expect((await readFile(target())).equals(CONTENT)).toBe(true);
  expect(await leftovers()).toEqual([]);
}, 60_000);

it("retries each mirror alone after a checksum failure", async () => {
  behaviors.set("a", "wrong").set("b", "ok");
  await download(model("a", "b"));
  expect((await readFile(target())).equals(CONTENT)).toBe(true);
}, 60_000);

it("keeps nothing when no mirror provides the expected content", async () => {
  behaviors.set("a", "wrong").set("b", "wrong");
  await expect(download(model("a", "b"))).rejects.toThrow(AggregateError);
  await expect(readFile(target())).rejects.toMatchObject({ code: "ENOENT" });
  expect(await leftovers()).toEqual([]);
}, 60_000);

it("skips verified files without contacting mirrors", async () => {
  await mkdir(path.dirname(target()), { recursive: true });
  await writeFile(target(), CONTENT);
  await download(model("a"));
  expect(ranges).toEqual([]);
}, 60_000);

it("resumes an interrupted download from the retained partial file", async () => {
  behaviors.set("a", "cut");
  await expect(download(model("a"))).rejects.toThrow("failed");
  await expect(readFile(target())).rejects.toMatchObject({ code: "ENOENT" });
  expect(await leftovers()).toHaveLength(2); // 临时文件与 aria2 控制文件保留供续传。
  ranges.length = 0;
  behaviors.set("a", "ok");
  await download(model("a"));
  expect((await readFile(target())).equals(CONTENT)).toBe(true);
  expect(ranges).toContain(`a:${2 * CUT}`); // 两次各断在 1 MiB 处，续传从已下载的位置开始。
}, 60_000);
