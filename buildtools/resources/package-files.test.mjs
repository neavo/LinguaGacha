import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { prune_workspace_package_files } from "./package-files.mjs";

it("依赖裁剪移除 Node 不用的资源，保留运行文件、类型和 npm 元数据", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lg-package-files-"));
  const modules = path.join(root, "node_modules");
  const files = [
    "exceljs/package.json",
    "exceljs/index.js",
    "exceljs/index.d.ts",
    "exceljs/lib/workbook.js",
    "exceljs/lib/workbook.js.map",
    "exceljs/dist/browser.js",
    "mupdf/dist/mupdf-wasm.wasm",
    "mupdf/dist/mupdf-wasm.wasm.br",
    "@fixture/pdf/node_modules/mupdf/dist/mupdf-wasm.wasm",
    "@fixture/pdf/node_modules/mupdf/dist/mupdf-wasm.wasm.br",
    ".package-lock.json",
    ".bin/fixture.cmd",
  ];
  try {
    for (const file of files) {
      await mkdir(path.dirname(path.join(modules, file)), { recursive: true });
      await writeFile(path.join(modules, file), file);
    }
    await prune_workspace_package_files(root);
    const removed = new Set([
      "exceljs/lib/workbook.js.map",
      "exceljs/dist/browser.js",
      "mupdf/dist/mupdf-wasm.wasm.br",
      "@fixture/pdf/node_modules/mupdf/dist/mupdf-wasm.wasm.br",
    ]);
    for (const file of files) {
      if (removed.has(file))
        await expect(readFile(path.join(modules, file))).rejects.toMatchObject({ code: "ENOENT" });
      else expect(await readFile(path.join(modules, file), "utf8")).toBe(file);
    }
    expect(await readdir(path.join(modules, "exceljs"))).not.toContain("dist");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
