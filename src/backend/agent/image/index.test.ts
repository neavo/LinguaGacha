import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { image_fixture } from "../../../test/image-fixture";
import { ImageFormat, image_sha256 } from "../../file/image/image-format";
import { bind_workspace_requests } from "../workspace/runtime/request-channel";
import { restore, read, apply, execute, publish } from "./index";

const repairCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("./engine", () => ({
  pixels: async (command: string, args: Record<string, unknown>) => {
    if (command === "repair" || command === "layout") {
      if (command === "repair") repairCalls.count++;
      const page = args.page as import("../../../shared/image").ImagePage;
      const output = args.output as string;
      await fs.mkdir(output, { recursive: true });
      const base = path.join(output, "base.png");
      await fs.copyFile(args.source as string, base);
      if (command === "layout")
        return page.regions.map((region) => ({
          regionId: region.regionId,
          groupId: page.groups[0]!.groupId,
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          mask: base,
          measurement: { status: "uncertain", value: null },
        }));
      return {
        base,
        groups: page.groups.map((group) => ({
          groupId: group.groupId,
          ready: true,
          reason: null,
          mask: base,
        })),
      };
    }
    if (command === "composite") {
      await fs.copyFile(args.source as string, args.output as string);
      return { path: args.output, rejectedGroups: [] };
    }
    throw new Error("Unexpected pixel operation");
  },
}));
let root: string | undefined;
afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
  repairCalls.count = 0;
});

/** 以真实包、快照和目录验证 SDK 状态，昂贵像素计算使用替身。 */
async function fixture() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "lg-image-state-"));
  const source = path.join(root, "source"),
    work = path.join(root, "work"),
    writeback = path.join(root, "writeback");
  const f = image_fixture();
  const bytes = await f.pack();
  await fs.mkdir(path.join(source, "originals"), { recursive: true });
  await fs.mkdir(writeback);
  for (const page of f.book.pages) await fs.writeFile(path.join(source, page.original), f.original);
  await fs.writeFile(path.join(source, "image.json"), JSON.stringify(f.book));
  await fs.writeFile(path.join(source, "items.json"), JSON.stringify(f.records));
  await fs.writeFile(
    path.join(source, "image-source.json"),
    JSON.stringify({ sourceSha256: image_sha256(bytes) }),
  );
  await restore(source, work);
  const format = new ImageFormat(),
    items = (await format.read(bytes, "book.image")).items;
  items[0]!.status = "PROCESSED";
  items[0]!.dst = "";
  const generate = async () => {
    const output = await format.render(bytes, items, "book.image", {
      generationId: "test",
      projectPath: "p.lg",
      revisions: {},
    });
    await fs.writeFile(path.join(writeback, "items.json"), output.text);
    await fs.writeFile(
      path.join(writeback, "image-writeback.json"),
      JSON.stringify(output.manifest),
    );
  };
  await generate();
  bind_workspace_requests({
    call: async (request) => {
      if (request.kind !== "render_image") throw new Error("Unexpected host call");
      expect(
        request.regions.every((region) => region.text === "" || region.text === "new translation"),
      ).toBe(true);
      return {
        regions: request.regions.map((region) => ({
          regionId: region.regionId,
          ready: true,
          size: 0,
          tiles: [],
        })),
      };
    },
  });
  return { work, writeback, generate, items };
}

it("同修订并发草稿提交只接纳一个写入", async () => {
  const { work } = await fixture();
  const state = await read(work);
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      apply(work, 0, { pages: state.book.pages, records: state.records, confirmed: true }),
    ),
  );
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect((await read(work)).revision).toBe(1);
});

it("完成清单控制整组恢复，改译文复用修复，发布拒绝陈旧输入并支持同执行重试", async () => {
  const { work, writeback, items, generate } = await fixture();
  const options = { workDirectory: work, writebackDirectory: writeback, device: "cpu" as const };
  const first = await execute(options);
  expect(first.pages.map((page) => page.groups[0]!.ready)).toEqual([true, false]);
  const repaired = repairCalls.count;
  items[0]!.dst = "new translation";
  await generate();
  const second = await execute(options);
  expect(repairCalls.count).toBe(repaired); // 译文更新不触发修复，同图同编辑范围也可复用。
  const reviews = second.pages.flatMap((page) =>
    page.groups.map((group) => ({
      pageId: page.pageId,
      groupId: group.groupId,
      decision: group.ready ? ("accept" as const) : ("preserve" as const),
    })),
  );
  const outputDirectory = path.join(root!, "delivery");
  await expect(
    publish({ workDirectory: work, executionId: first.executionId, outputDirectory, reviews }),
  ).rejects.toThrow("Generation changed");
  await expect(
    publish({
      workDirectory: work,
      executionId: second.executionId,
      outputDirectory,
      reviews: reviews.map((review) => ({ ...review, decision: "accept" })),
    }),
  ).rejects.toThrow("not ready");
  const result = await publish({
    workDirectory: work,
    executionId: second.executionId,
    outputDirectory,
    reviews,
  });
  expect(result).toMatchObject({
    status: "partial",
    pages: [{ pageId: "first" }, { pageId: "second" }],
  });
  expect(
    (
      await publish({
        workDirectory: work,
        executionId: second.executionId,
        outputDirectory,
        reviews,
      })
    ).path,
  ).toBe(result.path);
  expect(
    (await fs.readdir(outputDirectory)).filter((name) => name.startsWith("image-")),
  ).toHaveLength(1);
});
