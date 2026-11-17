import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { selection_fixture } from "../../../test/image-fixture";
import { png_fixture } from "../../../test/media-fixture";

const fake = vi.hoisted(() => ({ devices: [] as unknown[] }));
vi.mock("./engine", () => ({
  pixels: vi.fn(async (command: string, args: Record<string, unknown>, device?: unknown) => {
    fake.devices.push(device);
    if (command === "create") {
      const root = String(args.output);
      const png = png_fixture();
      const mask = selection_fixture();
      return {
        pages: (args.pages as Record<string, unknown>[]).map((spec) => {
          const pageId = String(spec.pageId);
          const layout = `layout-areas/${pageId}/r0001.png`;
          const eraseMask = `erase-masks/${pageId}/r0001.png`;
          const clean = `clean/${pageId}.png`;
          const preview = path.join(root, "diagnostics", `${pageId}.png`);
          for (const [member, bytes] of [
            [layout, mask],
            [eraseMask, mask],
            [clean, png],
            [path.relative(root, preview), png],
          ] as const) {
            const file = path.join(root, member);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, bytes);
          }
          return {
            page: {
              ...Object.fromEntries(
                [
                  "pageId",
                  "relativePath",
                  "original",
                  "sha256",
                  "width",
                  "height",
                  "orientation",
                ].map((key) => [key, spec[key]]),
              ),
              textBoxes: [
                {
                  textBoxId: "t0001",
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
                  text: "原文",
                },
              ],
              regions: [
                {
                  regionId: "r0001",
                  kind: "bubble",
                  textBoxIds: ["t0001"],
                  layoutArea: { path: layout },
                  direction: "vertical-rl",
                  backgroundColor: [255, 255, 255],
                },
              ],
            },
            records: [{ pageId, regionId: "r0001", message: "原文" }],
            clean: {
              pageId,
              clean,
              regions: [
                {
                  regionId: "r0001",
                  status: "cleaned",
                  eraseMask,
                },
              ],
            },
            diagnostics: { preview, detected: 1, regions: 1, failures: [] },
          };
        }),
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  }),
}));

import { describe_package, processPages } from "./index";

it("整册默认使用 GPU 生成当前图片成员与独立诊断", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-create-"));
  const source = path.join(temporary.path, "page.png");
  const output = path.join(temporary.path, "book");
  fs.writeFileSync(source, png_fixture());

  const result = await processPages([{ path: source, relativePath: "chapter/page.png" }], output);

  expect(fake.devices[0]).toBe("gpu");
  expect(describe_package()).toContain("ImageBook");
  expect(result).toMatchObject({
    directory: output,
    package_directory: path.join(output, "package"),
    pages: [{ diagnostics: { detected: 1, regions: 1, failures: [] } }],
  });
  const page = result.pages[0]!;
  expect(fs.existsSync(page.diagnostics.preview)).toBe(true);
  expect(fs.existsSync(path.join(result.package_directory, page.page.original))).toBe(true);
  expect(page.records).toEqual([{ pageId: page.page.pageId, regionId: "r0001", message: "原文" }]);
});
