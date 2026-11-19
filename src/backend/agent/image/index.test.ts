import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { layout_area_fixture, patch_fixture } from "../../../test/image-fixture";
import { png_fixture } from "../../../test/media-fixture";
import type { ImageHelperRequest } from "../../../shared/image-helper";

const fake = vi.hoisted(() => ({
  pages: [] as ImageHelperRequest<"scan">["pages"],
}));

vi.mock("./engine", () => ({
  pixels: async (_script: URL, command: string, args: Record<string, unknown>) => {
    if (command === "scan") {
      const { pages, output } = args as ImageHelperRequest<"scan">;
      fake.pages = pages;
      return {
        pages: pages.map(({ pageId, relativePath }) => {
          const preview = path.join(output, "diagnostics", pageId + ".png");
          fs.mkdirSync(path.dirname(preview), { recursive: true });
          fs.writeFileSync(preview, png_fixture());
          return {
            pageId,
            relativePath,
            preview,
            records: [{ regionId: "r1", group: "r1", kind: "bubble", message: "原文" }],
          };
        }),
      };
    }
    if (command === "prepare") {
      const { output, selected, previous, repartition, reserved } =
        args as ImageHelperRequest<"prepare">;
      const picks = repartition
        ? [
            { pageId: repartition.pageId, regionId: "r1-qa-a", message: "第一格", contour: true },
            { pageId: repartition.pageId, regionId: "r1-qa-b", message: "第二格" },
            { pageId: repartition.pageId, regionId: "r1", message: "两格对白" },
          ]
        : selected;
      if (repartition && reserved?.length !== 1) throw new Error("Missing unchanged layout area");
      return {
        records: picks.map(({ pageId, regionId, message }) => ({
          pageId,
          regionId,
          message: message ?? "原文",
        })),
        pages: fake.pages.map(({ source: _source, ...page }) => ({
          ...page,
          regions: picks
            .filter(({ pageId }) => pageId === page.pageId)
            .map(({ regionId, contour }) => {
              const whole = repartition && regionId === repartition.group;
              const member = ["patches", page.pageId, regionId + ".png"].join("/");
              const file = path.join(output, member);
              if (!whole && (!previous || repartition)) {
                const area = path.join(output, "layout-areas", page.pageId, regionId + ".png");
                fs.mkdirSync(path.dirname(area), { recursive: true });
                fs.writeFileSync(area, layout_area_fixture());
              }
              if (contour) {
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, patch_fixture());
              }
              return {
                regionId,
                kind: "bubble",
                box: [0, 0, 1, 1],
                direction: "vertical-rl",
                backgroundColor: [255, 255, 255],
                patch: contour ? { path: member, box: [0, 0, 1, 1] } : null,
                ...(whole ? { parts: ["r1-qa-a", "r1-qa-b"] } : {}),
              };
            }),
        })),
      };
    }
    throw new Error("Unexpected image helper command");
  },
}));

import { create_image_pipeline, read_image_package_manifest } from "./index";

const {
  scan: scanPages,
  prepare: preparePages,
  repartition: repartitionBubbleGroup,
} = create_image_pipeline(new URL("file:///fixture/helper.py"));

it("先发布选字预览，再封装已确认原文和消字补丁", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-prepare-"));
  const source = path.join(temporary.path, "page.png");
  fs.writeFileSync(source, png_fixture());
  const scan = await scanPages(
    [{ path: source, relativePath: "chapter/page.png" }],
    path.join(temporary.path, "scan"),
  );
  const page = scan.pages[0]!;
  expect(fs.existsSync(page.preview)).toBe(true);
  expect(fs.existsSync(path.join(scan.directory, "package"))).toBe(false);
  const output = path.join(temporary.path, "book");
  await preparePages(
    scan.directory,
    [{ pageId: page.pageId, regionId: "r1", message: "校正后的原文" }],
    output,
  );
  const updated = path.join(temporary.path, "updated");
  await preparePages(
    scan.directory,
    [{ pageId: page.pageId, regionId: "r1", contour: true }],
    updated,
    {
      update: output,
    },
  );
  const patchPath = path.join("package", "patches", page.pageId, "r1.png");
  expect(fs.existsSync(path.join(output, patchPath))).toBe(false);
  expect(fs.readFileSync(path.join(updated, patchPath))).toEqual(patch_fixture());
  expect(fs.readFileSync(path.join(updated, "package/items.json"), "utf8")).toBe(
    fs.readFileSync(path.join(output, "package/items.json"), "utf8"),
  );
  expect(JSON.parse(fs.readFileSync(path.join(output, "package/items.json"), "utf8"))).toEqual([
    { pageId: page.pageId, regionId: "r1", message: "校正后的原文" },
  ]);
});

it("补做分格只替换目标组，整泡补做复用子格补丁", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-repartition-"));
  const source = path.join(temporary.path, "page.png");
  fs.writeFileSync(source, png_fixture());
  const scan = await scanPages(
    [{ path: source, relativePath: "page.png" }],
    path.join(temporary.path, "scan"),
  );
  const { pageId } = scan.pages[0]!;
  const previous = path.join(temporary.path, "book");
  await preparePages(
    scan.directory,
    [
      { pageId, regionId: "r1" },
      { pageId, regionId: "r10", message: "不变的原文", contour: true },
    ],
    previous,
  );
  const corrected = path.join(temporary.path, "corrected");
  await repartitionBubbleGroup(
    scan.directory,
    {
      pageId,
      group: "r1",
      parts: [
        { textBoxIds: ["t1"], translate: true },
        { textBoxIds: ["t2"], translate: true },
      ],
    },
    previous,
    corrected,
  );
  const check = read_image_package_manifest(path.join(corrected, "package"));
  expect(check.records.map(({ regionId, message }) => [regionId, message])).toEqual([
    ["r1-qa-a", "第一格"],
    ["r1-qa-b", "第二格"],
    ["r1", "原文"],
    ["r10", "不变的原文"],
  ]);
  const untouched = check.book.pages[0]!.regions.find(({ regionId }) => regionId === "r10")!.patch!
    .path;
  expect(fs.readFileSync(path.join(corrected, "package", untouched))).toEqual(
    fs.readFileSync(path.join(previous, "package", untouched)),
  );
  const updated = path.join(temporary.path, "updated");
  await preparePages(scan.directory, [{ pageId, regionId: "r1", contour: true }], updated, {
    update: corrected,
  });
  const after = read_image_package_manifest(path.join(updated, "package"));
  expect(after.records).toEqual(check.records);
  expect(
    after.book.pages[0]!.regions.filter(({ parts }) => !parts).every(({ patch }) => patch),
  ).toBe(true);
  expect(after.book.pages[0]!.regions.find(({ regionId }) => regionId === "r1")).toMatchObject({
    patch: null,
    parts: ["r1-qa-a", "r1-qa-b"],
  });
});
