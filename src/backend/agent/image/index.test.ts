import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { selection_fixture } from "../../../test/image-fixture";
import { png_fixture } from "../../../test/media-fixture";
import { write_zip } from "../../../test/zip-fixture";
import { read_image_package } from "../../file/image/image-format";

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

import { createImage } from "./index";

it("整册默认使用 GPU 创建后只保留归档和诊断预览", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-create-"));
  const source = path.join(temporary.path, "page.png");
  const output = path.join(temporary.path, "book.image");
  fs.writeFileSync(source, png_fixture());

  const result = await createImage([{ path: source, relativePath: "chapter/page.png" }], output);
  const archive = await read_image_package(fs.readFileSync(output), output);

  expect(fake.devices[0]).toBe("gpu");
  expect(result).toMatchObject({
    output_path: output,
    diagnostics_path: `${output}.diagnostics`,
    pages: [{ detected: 1, regions: 1, failures: [] }],
  });
  expect(fs.existsSync(result.pages[0]!.preview_path)).toBe(true);
  expect(archive.records).toEqual([
    { pageId: archive.book.pages[0]!.pageId, regionId: "r0001", message: "原文" },
  ]);
});
