import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { remove_license_files } from "./license-files.mjs";

it("清理生成目录及嵌套依赖的许可文本，保留运行代码和普通资源", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lg-license-files-"));
  const removed = [
    "LICENSE.electron.txt",
    "LICENSES.chromium.html",
    "workspace/python/LICENSE",
    "workspace/npm/LICENSE",
    "workspace/npm/node_modules/fixture/license.md",
    "workspace/npm/node_modules/fixture/lib/LICENSE.APACHE",
    "workspace/npm/node_modules/fixture/lib/LICENSE.BSD",
    "workspace/seed/node_modules/fixture/LICENSE-MIT.txt",
    "workspace/seed/node_modules/fixture/LICENCE.markdown",
    "workspace/seed/node_modules/fixture/NOTICE",
    "workspace/seed/node_modules/fixture/COPYING.txt",
    "workspace/seed/node_modules/fixture/Copyright",
  ];
  const kept = [
    "workspace/npm/lib/license.js",
    "workspace/npm/lib/license_header.js",
    "workspace/npm/lib/license.cjs",
    "workspace/npm/lib/license.mjs",
    "workspace/npm/lib/license.json",
    "workspace/npm/package.json",
    "workspace/node_modules/fixture/README.md",
    "workspace/python/tree-sitter-python.wasm",
    "workspace/bin/win32-x64/uv.exe",
  ];
  try {
    for (const file of [...removed, ...kept]) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), file);
    }
    await remove_license_files(root);
    for (const file of removed)
      await expect(readFile(path.join(root, file))).rejects.toMatchObject({ code: "ENOENT" });
    for (const file of kept) expect(await readFile(path.join(root, file), "utf8")).toBe(file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
