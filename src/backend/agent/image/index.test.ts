import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { default_native_fs } from "../../../native/native-fs";
import type { ImagePage } from "../../../shared/image";
import { selection_fixture } from "../../../test/image-fixture";
import { png_fixture } from "../../../test/media-fixture";
import { write_zip } from "../../../test/zip-fixture";
import { image_sha256, read_image_package } from "../../file/image/image-format";

const mockState = vi.hoisted(() => ({ bubble: true }));

beforeEach(() => {
  mockState.bubble = true;
});

vi.mock("./engine", () => ({
  pixels: vi.fn(async (command: string, args: Record<string, unknown>) => {
    const png = png_fixture();
    const pngSha = image_sha256(png);
    const mask = selection_fixture();
    const maskSha = image_sha256(mask);
    const output = String(args.output ?? "");
    if (command === "prepare") {
      const pageId = String(args.pageId);
      const preview = path.join(output, "preview.png");
      fs.mkdirSync(path.dirname(preview), { recursive: true });
      fs.writeFileSync(preview, png);
      const layoutArea = { path: `layout-areas/${pageId}/r1.png`, sha256: maskSha };
      if (mockState.bubble) {
        const file = path.join(String(args.layoutAreaRoot), layoutArea.path);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, mask);
      }
      return {
        width: 1,
        height: 1,
        preview,
        previewScale: 1,
        fillPreview: preview,
        textBoxes: [
          {
            textBoxId: "t1",
            box: [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ],
            coreBox: [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ],
            ownerRegionId: mockState.bubble ? "r1" : null,
          },
        ],
        backgrounds: mockState.bubble
          ? { r1: { route: "fill", coverage: 1, samplePixels: 1 } }
          : {},
        crops: {},
        candidates: [],
        draftRegions: mockState.bubble
          ? [
              {
                regionId: "r1",
                kind: "bubble",
                disposition: "translate",
                textBoxIds: ["t1"],
                layoutArea,
                direction: null,
                backgroundColor: [255, 255, 255],
              },
            ]
          : [],
      };
    }
    if (command === "layout_areas") {
      const page = args.page as ImagePage;
      const groups = args.groups as { regionId: string; textBoxIds: string[] }[];
      const regions = groups.map((group) => {
        const member = `layout-areas/${page.pageId}/${group.regionId}.png`;
        const file = path.join(output, member);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, mask);
        return {
          regionId: group.regionId,
          kind: "unframed" as const,
          disposition: "translate" as const,
          textBoxIds: group.textBoxIds,
          layoutArea: { path: member, sha256: maskSha },
          direction: null,
          backgroundColor: [255, 255, 255] as [number, number, number],
        };
      });
      return {
        regions,
        backgrounds: Object.fromEntries(
          groups.map((group) => [group.regionId, { route: "fill", coverage: 1, samplePixels: 1 }]),
        ),
      };
    }
    if (command === "erase") {
      const page = args.page as ImagePage;
      const regions = page.regions
        .filter((region) => region.disposition === "translate")
        .map((region) => {
          const root = path.join(output, region.regionId);
          fs.mkdirSync(root, { recursive: true });
          const crop = path.join(root, "A.png");
          const candidateMask = path.join(root, "A-mask.png");
          fs.writeFileSync(crop, png);
          fs.writeFileSync(candidateMask, mask);
          return {
            regionId: region.regionId,
            candidates: [
              {
                candidateId: "A",
                method: "fill",
                box: [0, 0, 1, 1],
                crop,
                cropSha256: pngSha,
                eraseMask: candidateMask,
                eraseMaskSha256: maskSha,
              },
            ],
            diagnostics: [],
          };
        });
      const material = path.join(output, "materials", "candidates-001.png");
      fs.mkdirSync(path.dirname(material), { recursive: true });
      fs.writeFileSync(material, png);
      return { regions, materials: regions.length ? [material] : [] };
    }
    if (command === "compose_candidates") {
      const selected = args.selected as {
        regionId: string;
        disposition: "translate" | "preserve";
        preserveReason?: "intentional" | "repair_failed" | "unreadable";
      }[];
      const clean = path.join(output, "clean.png");
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(clean, png);
      return {
        clean,
        cleanSha256: pngSha,
        regions: selected.map((region) => {
          if (region.disposition === "preserve") return region;
          const maskFile = path.join(output, "masks", `${region.regionId}.png`);
          fs.mkdirSync(path.dirname(maskFile), { recursive: true });
          fs.writeFileSync(maskFile, mask);
          return { ...region, eraseMask: maskFile, eraseMaskSha256: maskSha };
        }),
      };
    }
    if (command === "pack") {
      const entries = new Map<string, string | Uint8Array>([
        ["image.json", JSON.stringify(args.book)],
        ["items.json", JSON.stringify(args.records)],
        ["clean.json", JSON.stringify(args.clean)],
      ]);
      for (const [member, source] of Object.entries(args.sources as Record<string, string>))
        entries.set(member, fs.readFileSync(source));
      fs.writeFileSync(String(args.output), await write_zip(entries));
      return { path: args.output };
    }
    throw new Error(`Unexpected command: ${command}`);
  }),
}));

import { apply, erase, pack, prepare, read, review } from "./index";

/** 为准备得到的区域补齐方向与原文。 */
const confirm = (page: ImagePage, message = "原文") => ({
  pages: [
    {
      ...page,
      regions: page.regions.map((region) => ({ ...region, direction: "vertical-rl" as const })),
    },
  ],
  records: [{ pageId: page.pageId, regionId: page.regions[0]!.regionId, message }],
  confirmed: true,
});

describe("@lg/image candidate transaction", () => {
  it("产品 Agent 提交候选决定后可重放并统一归档实际掩码", async () => {
    using tmp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-candidate-"));
    const source = path.join(tmp.path, "page.png");
    fs.writeFileSync(source, png_fixture());
    const work = path.join(tmp.path, "work");
    const prepared = await prepare({ sources: [source], workDirectory: work });
    const confirmed = await apply(work, 0, confirm(prepared.book.pages[0]!));
    const run = await erase({ workDirectory: work, expectedRevision: confirmed.revision });

    expect(run.pages[0]!.materials).toHaveLength(1);
    expect(fs.existsSync(run.pages[0]!.materials[0]!)).toBe(true);

    const committed = await review({
      workDirectory: work,
      runId: run.runId,
      expectedRevision: run.revision,
      pages: [
        {
          pageId: prepared.book.pages[0]!.pageId,
          regions: [{ regionId: "r1", value: "A" }],
        },
      ],
    });
    expect(committed.status).toBe("complete");
    const replayed = await review({
      workDirectory: work,
      runId: run.runId,
      expectedRevision: run.revision,
      pages: [
        {
          pageId: prepared.book.pages[0]!.pageId,
          regions: [{ regionId: "r1", value: "A" }],
        },
      ],
    });
    expect(replayed.replayed).toBe(true);
    expect(replayed.revision).toBe(committed.revision);

    const output = path.join(tmp.path, "book.image");
    expect((await pack(work, output)).status).toBe("complete");
    const archive = await read_image_package(fs.readFileSync(output), output);
    expect(archive.clean.pages[0]!.regions[0]!.eraseMask).toBe(
      `erase-masks/${prepared.book.pages[0]!.pageId}/r1.png`,
    );
  });

  it("非法选择不改草稿，显式失败形成 partial", async () => {
    using tmp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-invalid-choice-"));
    const source = path.join(tmp.path, "page.png");
    fs.writeFileSync(source, png_fixture());
    const work = path.join(tmp.path, "work");
    const prepared = await prepare({ sources: [source], workDirectory: work });
    const confirmed = await apply(work, 0, confirm(prepared.book.pages[0]!));
    const run = await erase({ workDirectory: work, expectedRevision: confirmed.revision });
    await expect(
      review({
        workDirectory: work,
        runId: run.runId,
        expectedRevision: run.revision,
        pages: [
          {
            pageId: prepared.book.pages[0]!.pageId,
            regions: [{ regionId: "r1", value: "Z" }],
          },
        ],
      }),
    ).rejects.toThrow("Invalid candidate decision");
    expect((await read(work)).book.pages[0]!.regions[0]!.disposition).toBe("translate");
    const committed = await review({
      workDirectory: work,
      runId: run.runId,
      expectedRevision: run.revision,
      pages: [
        {
          pageId: prepared.book.pages[0]!.pageId,
          regions: [{ regionId: "r1", value: "failed" }],
        },
      ],
    });
    expect(committed.status).toBe("partial");
    const current = await read(work);
    expect(current.book.pages[0]!.regions[0]!).toMatchObject({
      disposition: "preserve",
      preserveReason: "repair_failed",
    });
  });

  it("apply 为无框区域生成排版区域并原子提交", async () => {
    using tmp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-register-"));
    mockState.bubble = false;
    const source = path.join(tmp.path, "page.png");
    fs.writeFileSync(source, png_fixture());
    const work = path.join(tmp.path, "work");
    const prepared = await prepare({ sources: [source], workDirectory: work });
    const page = prepared.book.pages[0]!;
    const region = {
      regionId: "u1",
      kind: "unframed" as const,
      disposition: "translate" as const,
      textBoxIds: ["t1"],
      layoutArea: null,
      direction: "horizontal-tb" as const,
      backgroundColor: [255, 255, 255] as [number, number, number],
    };
    await expect(
      apply(work, 0, {
        pages: [{ ...page, regions: [region, { ...region, regionId: "u2" }] }],
        records: [
          { pageId: page.pageId, regionId: "u1", message: "一" },
          { pageId: page.pageId, regionId: "u2", message: "二" },
        ],
        confirmed: true,
      }),
    ).rejects.toThrow("duplicate region text box");
    const stateFile = path.join(work, "draft.json");
    const write = default_native_fs.write_file_atomic.bind(default_native_fs);
    const failure = vi
      .spyOn(default_native_fs, "write_file_atomic")
      .mockImplementation((file, bytes) => {
        if (file === stateFile) throw new Error("state write failed");
        write(file, bytes);
      });
    try {
      await expect(
        apply(work, 0, {
          pages: [{ ...page, regions: [region] }],
          records: [{ pageId: page.pageId, regionId: "u1", message: "无框原文" }],
          confirmed: true,
        }),
      ).rejects.toThrow("state write failed");
    } finally {
      failure.mockRestore();
    }
    expect((await read(work)).book.pages[0]!.regions).toEqual([]);
    const applied = await apply(work, 0, {
      pages: [{ ...page, regions: [region] }],
      records: [{ pageId: page.pageId, regionId: "u1", message: "无框原文" }],
      confirmed: true,
    });
    expect(applied.confirmed).toBe(true);
    expect(applied.book.pages[0]!.regions[0]!).toMatchObject({
      kind: "unframed",
      regionId: "u1",
    });
  });

  it("全保留页提交原图底图，单页区域变化只撤销该页验收", async () => {
    using tmp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-preserved-"));
    const source = path.join(tmp.path, "page.png");
    fs.writeFileSync(source, png_fixture());
    const secondSource = path.join(tmp.path, "second.png");
    fs.copyFileSync(source, secondSource);
    const work = path.join(tmp.path, "work");
    const prepared = await prepare({ sources: [source, secondSource], workDirectory: work });
    const page = prepared.book.pages[0]!;
    const applied = await apply(work, 0, {
      pages: prepared.book.pages.map((page) => ({
        ...page,
        regions: [
          {
            ...page.regions[0]!,
            disposition: "preserve",
            preserveReason: "intentional",
            direction: null,
            backgroundColor: null,
          },
        ],
      })),
      records: [],
      confirmed: true,
    });
    const run = await erase({ workDirectory: work, expectedRevision: applied.revision });
    expect(run.pages[0]!.regions).toEqual([]);
    expect(run.pages[0]!.materials).toEqual([]);
    const committed = await review({
      workDirectory: work,
      runId: run.runId,
      expectedRevision: run.revision,
      pages: [],
    });
    expect(committed.status).toBe("complete");
    const current = await read(work);
    await apply(work, committed.revision, {
      pages: current.book.pages.map((item) =>
        item.pageId === page.pageId
          ? { ...item, regions: [], falsePositiveTextBoxIds: ["t1"] }
          : item,
      ),
      records: [],
      confirmed: true,
    });
    expect((await read(work)).reviewStatus.map((page) => page.reviewed)).toEqual([false, true]);
  });
});
