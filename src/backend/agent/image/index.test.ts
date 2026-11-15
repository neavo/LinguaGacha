import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NativeFs, default_native_fs } from "../../../native/native-fs";
import { write_agent_workspace_sources } from "../workspace/sources";
import { image_sha256, read_image_package } from "../../file/image/image-format";
import type { ImagePage, ImageRecord } from "../../../shared/image";
import { selection_fixture } from "../../../test/image-fixture";
import { png_fixture } from "../../../test/media-fixture";
import { write_zip } from "../../../test/zip-fixture";

const mockState = vi.hoisted(() => ({
  eraseCalls: 0,
  tamperCleanOnErase: false,
  failOnErase: false,
}));

beforeEach(() => {
  mockState.eraseCalls = 0;
  mockState.tamperCleanOnErase = false;
  mockState.failOnErase = false;
});

vi.mock("./engine", () => ({
  pixels: vi.fn(async (command: string, args: Record<string, unknown>) => {
    const png = png_fixture();
    const sha = image_sha256(png);

    if (command === "prepare") {
      const out = String(args.output);
      fs.mkdirSync(path.join(out, "crops"), { recursive: true });
      const preview = path.join(out, "preview.png");
      const crop = path.join(out, "crops", "r1.png");
      fs.writeFileSync(preview, png);
      fs.writeFileSync(crop, png);
      const mask = selection_fixture();
      const member = `masks/${String(args.pageId)}/r1.png`;
      const maskFile = path.join(String(args.selectionRoot), member);
      fs.mkdirSync(path.dirname(maskFile), { recursive: true });
      fs.writeFileSync(maskFile, mask);
      const selection = { path: member, sha256: image_sha256(mask) };
      return {
        width: 1,
        height: 1,
        preview,
        previewScale: 1,
        fillPreview: preview,
        crops: { r1: crop },
        candidates: [
          {
            regionId: "r1",
            score: 0.9,
            rawMask: maskFile,
            box: [0, 0, 1, 1],
            overlaps: [],
            status: "ready",
          },
        ],
        draftRegions: [
          {
            regionId: "r1",
            disposition: "translate",
            selection,
            direction: null,
            fill: { color: [255, 255, 255] },
          },
        ],
      };
    }

    if (command === "erase") {
      mockState.eraseCalls++;
      if (mockState.failOnErase) throw new Error("Invalid selection");
      const out = String(args.output);
      const page = args.page as ImagePage;
      fs.mkdirSync(path.join(out, "masks"), { recursive: true });
      const cleanPath = path.join(out, "clean.png");
      const overlayPath = path.join(out, "mask-overlay.png");
      fs.writeFileSync(cleanPath, png);
      fs.writeFileSync(overlayPath, png);

      const regions = page.regions.map((r) => {
        if (r.disposition === "preserve") {
          return {
            regionId: r.regionId,
            disposition: "preserve",
            preserveReason: r.preserveReason,
          };
        }
        const maskPath = path.join(out, "masks", `${r.regionId}.png`);
        fs.writeFileSync(maskPath, selection_fixture());
        return {
          regionId: r.regionId,
          disposition: "translate",
          mask: maskPath,
          maskSha256: image_sha256(selection_fixture()),
        };
      });
      return {
        clean: cleanPath,
        cleanSha256: mockState.tamperCleanOnErase ? "0".repeat(64) : sha,
        overlay: overlayPath,
        regions,
      };
    }

    if (command === "pack") {
      const entries = new Map<string, string | Uint8Array>([
        ["image.json", JSON.stringify(args.book)],
        ["items.json", JSON.stringify(args.records)],
        ["clean.json", JSON.stringify(args.clean)],
      ]);
      for (const [member, source] of Object.entries(args.sources as Record<string, string>)) {
        entries.set(member, fs.readFileSync(source));
      }
      fs.writeFileSync(String(args.output), await write_zip(entries));
      return { path: args.output };
    }

    throw new Error(`Unexpected command: ${command}`);
  }),
}));

import { apply, erase, pack, prepare, publish, read, restore, review } from "./index";

describe("@lg/image phase-1 transaction loop", () => {
  it("完成全链路交付并检验反复交付产物", async () => {
    using tmp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-sdk-"));
    const src1 = path.join(tmp.path, "001.png");
    const src2 = path.join(tmp.path, "002.png");
    fs.writeFileSync(src1, png_fixture());
    fs.writeFileSync(src2, png_fixture());

    const work = path.join(tmp.path, "work");
    const prep = await prepare({ sources: [src1, src2], workDirectory: work });
    expect(prep.revision).toBe(0);
    expect(prep.confirmed).toBe(false);
    expect(prep.book.pages).toHaveLength(2);

    // 未 confirm 前禁止 erase / pack。
    await expect(erase({ workDirectory: work, expectedRevision: 0 })).rejects.toThrow("Confirm");
    await expect(pack(work, path.join(tmp.path, "out.image"))).rejects.toThrow("Confirm");

    // 提交并发冲突校验（陈旧 revision 拒绝），随后正式确认一页正常文本、第二页置为零文本封面。
    const confirmedPages: ImagePage[] = [
      {
        ...prep.book.pages[0]!,
        regions: [{ ...prep.book.pages[0]!.regions[0]!, direction: "vertical-rl" }],
      },
      { ...prep.book.pages[1]!, regions: [] },
    ];
    const records: ImageRecord[] = [
      { pageId: confirmedPages[0]!.pageId, regionId: "r1", message: "原文A" },
    ];
    const [r1, r2] = await Promise.allSettled([
      apply(work, 0, { pages: confirmedPages, records, confirmed: true }),
      apply(work, 0, { pages: confirmedPages, records, confirmed: true }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual(["fulfilled", "rejected"]);

    // erase 校验陈旧 revision、推进修订，且不自动算作已验收（reviewed 仍为空）。
    await expect(erase({ workDirectory: work, expectedRevision: 0 })).rejects.toThrow(
      "Stale image draft revision",
    );
    const run1 = await erase({ workDirectory: work, expectedRevision: 1 });
    expect(run1.revision).toBe(2);
    expect(mockState.eraseCalls).toBe(2);
    expect((await read(work)).reviewStatus.every((s) => !s.reviewed)).toBe(true);
    await expect(pack(work, path.join(tmp.path, "unreviewed.image"))).rejects.toThrow(
      "not reviewed",
    );

    // 验收第1页、驳回第2页后再单独验收第2页，每步均校验并推进 revision。
    await expect(
      review({
        workDirectory: work,
        runId: run1.runId,
        expectedRevision: 1,
        pages: [{ pageId: confirmedPages[0]!.pageId, decision: "accept" }],
      }),
    ).rejects.toThrow("Stale image draft revision");
    const rev1 = await review({
      workDirectory: work,
      runId: run1.runId,
      expectedRevision: run1.revision,
      pages: [
        { pageId: confirmedPages[0]!.pageId, decision: "accept" },
        { pageId: confirmedPages[1]!.pageId, decision: "reject", reason: "再看一眼" },
      ],
    });
    expect(rev1.revision).toBe(3);
    expect(rev1.unreviewedPages).toEqual([confirmedPages[1]!.pageId]);

    const rev2 = await review({
      workDirectory: work,
      runId: run1.runId,
      expectedRevision: rev1.revision,
      pages: [{ pageId: confirmedPages[1]!.pageId, decision: "accept" }],
    });
    expect(rev2.revision).toBe(4);
    expect(rev2.unreviewedPages).toEqual([]);

    // 只改 direction 与 records 原文不失效 eraseInputDigest，直接复用 reviewed，无需重新擦除。
    const postTextApply = await apply(work, rev2.revision, {
      pages: [
        {
          ...confirmedPages[0]!,
          regions: [{ ...confirmedPages[0]!.regions[0]!, direction: "horizontal-tb" }],
        },
        confirmedPages[1]!,
      ],
      records: [{ pageId: confirmedPages[0]!.pageId, regionId: "r1", message: "修订原文" }],
      confirmed: true,
    });
    expect((await read(work)).reviewStatus.every((s) => s.reviewed)).toBe(true);

    // 仅第2页再触发一次 cache 命中 erase 验证 cached=true。
    const runCached = await erase({
      workDirectory: work,
      expectedRevision: postTextApply.revision,
      pageIds: [confirmedPages[1]!.pageId],
    });
    expect(runCached.pages[0]!.cached).toBe(true);
    expect(mockState.eraseCalls).toBe(2);

    // 打包并经由 sources 离线恢复与幂等发布（全程不需重新 erase/模型）。
    const pkgPath = path.join(tmp.path, "book.image");
    const packed = await pack(work, pkgPath);
    expect(packed.status).toBe("complete");
    const pkgBytes = fs.readFileSync(pkgPath);
    const inspected = await read_image_package(pkgBytes, "book.image");
    expect(inspected.clean.status).toBe("complete");

    const sourceProj = path.join(tmp.path, "sources");
    await write_agent_workspace_sources({
      nativeFs: new NativeFs(),
      sourceRoot: sourceProj,
      files: [{ file_path: "book.image", file_type: "IMAGE" }],
      readAsset: () => pkgBytes,
    });
    const restoredWork = path.join(tmp.path, "restored");
    await restore(path.join(sourceProj, "book.image"), restoredWork);
    expect((await read(restoredWork)).reviewStatus.every((s) => s.reviewed)).toBe(true);

    const outDir = path.join(tmp.path, "published");
    const pub1 = await publish({
      workDirectory: restoredWork,
      outputDirectory: outDir,
      source: { kind: "clean" },
    });
    const pub2 = await publish({
      workDirectory: restoredWork,
      outputDirectory: outDir,
      source: { kind: "clean" },
    });
    expect(pub1.path).toBe(pub2.path);
    expect(fs.existsSync(path.join(pub1.path, "delivery.json"))).toBe(true);
    expect(fs.existsSync(path.join(pub1.path, `0001-${confirmedPages[0]!.pageId}.png`))).toBe(true);
    expect(fs.existsSync(path.join(pub1.path, "clean.json"))).toBe(false);
    expect(fs.existsSync(path.join(pub1.path, "image.json"))).toBe(false);

    // 摘要字段保持原值，清单的来源、输入和保留记录被改动也必须拒绝。
    const deliveryFile = path.join(pub1.path, "delivery.json");
    const deliveryText = fs.readFileSync(deliveryFile, "utf8");
    for (const changes of [
      { originalSha256: "a".repeat(64) },
      { inputSha256: "b".repeat(64) },
      { preserved: [{ regionId: "r1", reason: "repair_failed" }] },
    ]) {
      const changed = structuredClone(pub1);
      Object.assign(changed.pages[0]!, changes);
      const { path: _path, ...manifest } = changed;
      fs.writeFileSync(deliveryFile, JSON.stringify(manifest));
      await expect(
        publish({
          workDirectory: restoredWork,
          outputDirectory: outDir,
          source: { kind: "clean" },
        }),
      ).rejects.toThrow("manifest corrupted");
    }
    fs.writeFileSync(deliveryFile, deliveryText);

    // 删除已发布底图后，重复 publish 不得静默成功。
    fs.rmSync(path.join(pub1.path, `0001-${confirmedPages[0]!.pageId}.png`));
    await expect(
      publish({ workDirectory: restoredWork, outputDirectory: outDir, source: { kind: "clean" } }),
    ).rejects.toThrow("missing or corrupted");

    // 若后续对单页改填色导致 eraseInputDigest 变化，仅该页验收失效且拒绝拿旧 runId 验收。
    const postConfigApply = await apply(work, runCached.revision, {
      pages: [
        {
          ...confirmedPages[0]!,
          regions: [
            {
              ...confirmedPages[0]!.regions[0]!,
              fill: { color: [220, 180, 50] },
            },
          ],
        },
        confirmedPages[1]!,
      ],
      records: [{ pageId: confirmedPages[0]!.pageId, regionId: "r1", message: "修订原文" }],
      confirmed: true,
    });
    expect((await read(work)).reviewStatus.map((s) => s.reviewed)).toEqual([false, true]);
    await expect(
      review({
        workDirectory: work,
        runId: run1.runId,
        expectedRevision: postConfigApply.revision,
        pages: [{ pageId: confirmedPages[0]!.pageId, decision: "accept" }],
      }),
    ).rejects.toThrow("Stale erase run");
  });

  it("计算失败不推进修订，篡改产物拒绝验收，保留未解决区域生成 partial 归档", async () => {
    using tmp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-fail-"));
    const src = path.join(tmp.path, "p.png");
    fs.writeFileSync(src, png_fixture());
    const work = path.join(tmp.path, "work");
    const prep = await prepare({ sources: [src], workDirectory: work });
    const page = prep.book.pages[0]!;
    await apply(work, 0, {
      pages: [{ ...page, regions: [{ ...page.regions[0]!, direction: "vertical-rl" }] }],
      records: [{ pageId: page.pageId, regionId: "r1", message: "A" }],
      confirmed: true,
    });

    mockState.failOnErase = true;
    await expect(erase({ workDirectory: work, expectedRevision: 1 })).rejects.toThrow(
      "Invalid selection",
    );
    expect((await read(work)).revision).toBe(1);

    mockState.failOnErase = false;
    mockState.tamperCleanOnErase = true;
    const tamperedRun = await erase({ workDirectory: work, expectedRevision: 1 });
    await expect(
      review({
        workDirectory: work,
        runId: tamperedRun.runId,
        expectedRevision: tamperedRun.revision,
        pages: [{ pageId: page.pageId, decision: "accept" }],
      }),
    ).rejects.toThrow("digest mismatch");

    // 修复失败降级为 preserve (repair_failed) 后正常验收打包为 partial。
    mockState.tamperCleanOnErase = false;
    const appliedPartial = await apply(work, tamperedRun.revision, {
      pages: [
        {
          ...page,
          regions: [
            {
              regionId: "r1",
              disposition: "preserve",
              preserveReason: "repair_failed",
              selection: page.regions[0]!.selection,
              fill: null,
              direction: null,
            },
          ],
        },
      ],
      records: [],
      confirmed: true,
    });
    const runPartial = await erase({
      workDirectory: work,
      expectedRevision: appliedPartial.revision,
    });
    await review({
      workDirectory: work,
      runId: runPartial.runId,
      expectedRevision: runPartial.revision,
      pages: [{ pageId: page.pageId, decision: "accept" }],
    });
    const packed = await pack(work, path.join(tmp.path, "partial.image"));
    expect(packed.status).toBe("partial");
  });

  it("review 保证跨页原子性与按 runId 撤销验收，restore 失败不破坏原稿且成功后使缓存失效", async () => {
    using tmp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-atomic-"));
    const src1 = path.join(tmp.path, "p1.png");
    const src2 = path.join(tmp.path, "p2.png");
    fs.writeFileSync(src1, png_fixture());
    fs.writeFileSync(src2, png_fixture());
    const work = path.join(tmp.path, "work");
    const prep = await prepare({ sources: [src1, src2], workDirectory: work });
    const [p1, p2] = prep.book.pages;
    await apply(work, 0, {
      pages: [
        { ...p1!, regions: [{ ...p1!.regions[0]!, direction: "vertical-rl" }] },
        { ...p2!, regions: [{ ...p2!.regions[0]!, direction: "vertical-rl" }] },
      ],
      records: [
        { pageId: p1!.pageId, regionId: "r1", message: "A" },
        { pageId: p2!.pageId, regionId: "r1", message: "B" },
      ],
      confirmed: true,
    });

    mockState.failOnErase = false;
    mockState.tamperCleanOnErase = false;
    const mixedRun = await erase({ workDirectory: work, expectedRevision: 1 });
    // 第一页正常，第二页运行产物被破坏：整批 review 必须全部回滚（第一页也不应变为 reviewed）。
    fs.appendFileSync(mixedRun.pages[1]!.clean!, Buffer.from([1]));
    await expect(
      review({
        workDirectory: work,
        runId: mixedRun.runId,
        expectedRevision: mixedRun.revision,
        pages: [
          { pageId: p1!.pageId, decision: "accept" },
          { pageId: p2!.pageId, decision: "accept" },
        ],
      }),
    ).rejects.toThrow("digest mismatch");
    expect((await read(work)).reviewStatus.every((s) => !s.reviewed)).toBe(true);

    // 重新 erase 拿到完好产物并整批验收，随后 reject 同输入的另一 run 不影响当前引用；但 reject 当前已接受 runId 必须撤销该页验收。
    const goodRun = await erase({ workDirectory: work, expectedRevision: mixedRun.revision });
    const acceptedRes = await review({
      workDirectory: work,
      runId: goodRun.runId,
      expectedRevision: goodRun.revision,
      pages: [
        { pageId: p1!.pageId, decision: "accept" },
        { pageId: p2!.pageId, decision: "accept" },
      ],
    });
    const anotherRun = await erase({ workDirectory: work, expectedRevision: acceptedRes.revision });
    const otherRejectRes = await review({
      workDirectory: work,
      runId: anotherRun.runId,
      expectedRevision: anotherRun.revision,
      pages: [{ pageId: p1!.pageId, decision: "reject", reason: "保留此前成果" }],
    });
    expect((await read(work)).reviewStatus.every((s) => s.reviewed)).toBe(true);

    const revokeCurrentRes = await review({
      workDirectory: work,
      runId: goodRun.runId,
      expectedRevision: otherRejectRes.revision,
      pages: [{ pageId: p1!.pageId, decision: "reject", reason: "撤销当前运行验收" }],
    });
    expect((await read(work)).reviewStatus.map((s) => s.reviewed)).toEqual([false, true]);
    expect(revokeCurrentRes.unreviewedPages).toEqual([p1!.pageId]);

    // 向同一工作目录 restore 新版原稿后，规范化缓存必须失效并由新版原稿重建。
    const altSrc = path.join(tmp.path, "sources-alt", "book.image");
    const altBytes = Buffer.concat([png_fixture(), Buffer.from([0])]);
    const altSha = image_sha256(altBytes);
    const curState = await read(work);
    const updatedPage = { ...curState.book.pages[0]!, sha256: altSha, regions: [] };
    const updatedBook = { ...curState.book, pages: [updatedPage, curState.book.pages[1]!] };
    const altRecordList: ImageRecord[] = [{ pageId: p2!.pageId, regionId: "r1", message: "B" }];
    const p1CleanSha = image_sha256(png_fixture());
    const altClean = {
      version: 1 as const,
      bookId: updatedBook.bookId,
      status: "complete" as const,
      pages: [
        {
          pageId: p1!.pageId,
          clean: `clean/${p1!.pageId}.png`,
          cleanSha256: p1CleanSha,
          inputSha256: image_sha256(JSON.stringify({ source: [altSha, 1, 1, 1], regions: [] })),
          regions: [],
        },
        {
          pageId: p2!.pageId,
          clean: `clean/${p2!.pageId}.png`,
          cleanSha256: goodRun.pages[1]!.cleanSha256!,
          inputSha256: goodRun.pages[1]!.inputSha256,
          regions: goodRun.pages[1]!.regions.map((r) => ({
            regionId: r.regionId,
            disposition: "translate" as const,
            mask: `masks/${p2!.pageId}/${r.regionId}.png`,
            maskSha256: r.maskSha256!,
          })),
        },
      ],
    };
    fs.mkdirSync(path.join(altSrc, "originals"), { recursive: true });
    fs.mkdirSync(path.join(altSrc, "clean"), { recursive: true });
    fs.mkdirSync(path.join(altSrc, "masks", p2!.pageId), { recursive: true });
    fs.writeFileSync(path.join(altSrc, updatedPage.original), altBytes);
    fs.writeFileSync(path.join(altSrc, p2!.original), png_fixture());
    fs.writeFileSync(path.join(altSrc, `clean/${p1!.pageId}.png`), png_fixture());
    fs.writeFileSync(path.join(altSrc, `clean/${p2!.pageId}.png`), png_fixture());
    fs.writeFileSync(path.join(altSrc, `masks/${p2!.pageId}/r1.png`), selection_fixture());
    fs.writeFileSync(path.join(altSrc, "image.json"), JSON.stringify(updatedBook));
    fs.writeFileSync(path.join(altSrc, "items.json"), JSON.stringify(altRecordList));
    fs.writeFileSync(path.join(altSrc, "clean.json"), JSON.stringify(altClean));

    // 故意构造底图摘要不匹配的恢复源：restore 失败时工作区原稿字节与旧 draft 必须保持原样。
    const origP1Path = path.join(work, p1!.original);
    const prevOrigBytes = fs.readFileSync(origP1Path);
    const normMetaP1 = path.join(work, "normalized", `${p1!.pageId}.json`);
    const normMetaP2 = path.join(work, "normalized", `${p2!.pageId}.json`);
    const badCleanDoc = {
      ...altClean,
      pages: [altClean.pages[0]!, { ...altClean.pages[1]!, cleanSha256: "e".repeat(64) }],
    };
    fs.writeFileSync(path.join(altSrc, "clean.json"), JSON.stringify(badCleanDoc));
    await expect(restore(altSrc, work)).rejects.toThrow("Clean image digest mismatch");
    expect(fs.readFileSync(origP1Path).equals(prevOrigBytes)).toBe(true);
    expect((await read(work)).book.pages[0]!.sha256).toBe(p1!.sha256);

    // 模拟最终提交阶段写第 2 张原稿失败：第 1 张已替换的原稿、规范化缓存与旧 draft 必须完整回滚。
    fs.writeFileSync(path.join(altSrc, "clean.json"), JSON.stringify(altClean));
    const realCopyAtomic = default_native_fs.copy_file_atomic.bind(default_native_fs);
    let atomicWrites = 0;
    const copySpy = vi
      .spyOn(default_native_fs, "copy_file_atomic")
      .mockImplementation((srcPath, dstPath) => {
        atomicWrites++;
        if (atomicWrites === 2) throw new Error("Commit write failure");
        realCopyAtomic(srcPath, dstPath);
      });
    try {
      await expect(restore(altSrc, work)).rejects.toThrow("Commit write failure");
    } finally {
      copySpy.mockRestore();
    }
    expect(fs.readFileSync(origP1Path).equals(prevOrigBytes)).toBe(true);
    expect((await read(work)).book.pages[0]!.sha256).toBe(p1!.sha256);
    expect(JSON.parse(fs.readFileSync(normMetaP1, "utf8")).sourceSha256).toBe(p1!.sha256);

    // 恢复成功后，仅原稿变化的 p1 规范化缓存失效（未变的 p2 保留），再次 erase 按新版重建。
    await restore(altSrc, work);
    expect(fs.existsSync(normMetaP1)).toBe(false);
    expect(fs.existsSync(normMetaP2)).toBe(true);
    await erase({ workDirectory: work, expectedRevision: 0, pageIds: [p1!.pageId] });
    expect(JSON.parse(fs.readFileSync(normMetaP1, "utf8")).sourceSha256).toBe(altSha);
  });
});

it("确认只接受登记选区，缓存命中前拒绝被篡改的输入选区", async () => {
  using tmp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-selection-"));
  const source = path.join(tmp.path, "source.png");
  fs.writeFileSync(source, png_fixture());
  const work = path.join(tmp.path, "work");
  const prep = await prepare({ sources: [source], workDirectory: work });
  const page = structuredClone(prep.book.pages[0]!);
  page.regions[0]!.direction = "vertical-rl";
  const records = [{ pageId: page.pageId, regionId: "r1", message: "原文" }];
  const selection = page.regions[0]!.selection!;
  const originalSha = selection.sha256;
  selection.sha256 = "a".repeat(64);
  await expect(apply(work, 0, { pages: [page], records, confirmed: true })).rejects.toThrow(
    "not registered",
  );
  selection.sha256 = originalSha;
  await apply(work, 0, { pages: [page], records, confirmed: true });
  const run = await erase({ workDirectory: work, expectedRevision: 1 });
  fs.writeFileSync(path.join(work, selection.path), selection_fixture([0]));
  await expect(erase({ workDirectory: work, expectedRevision: run.revision })).rejects.toThrow(
    "digest mismatch",
  );
  expect((await read(work)).revision).toBe(run.revision);
});
