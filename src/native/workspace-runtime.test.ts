import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  resolve_workspace_runtime_directory,
  resolve_workspace_runtime_entry,
} from "./workspace-runtime";

it.each([
  [true, path.join("E:/app/resources", "workspace")],
  [false, path.join("E:/project", "build/resources/workspace")],
])("按运行模式定位整套资源 packaged=%s", (packaged, expected) => {
  expect(
    resolve_workspace_runtime_directory({
      packaged,
      resourcesPath: "E:/app/resources",
      projectRoot: "E:/project",
    }),
  ).toBe(expected);
});

it("从独立运行目录解析包导出，解析阶段不执行入口", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lg-runtime-exports-"));
  try {
    for (const [name, exports] of [
      ["@lg/workspace", { "./bootstrap": "./start.mjs" }],
      ["@lg/pdf", { ".": "./document.mjs", "./worker": "./thread.mjs" }],
    ] as const) {
      const package_directory = path.join(directory, "node_modules", name);
      await mkdir(package_directory, { recursive: true });
      await writeFile(
        path.join(package_directory, "package.json"),
        JSON.stringify({ name, type: "module", exports }),
      );
      for (const file of Object.values(exports)) {
        await writeFile(
          path.join(package_directory, file),
          "throw new Error('入口只能由执行进程加载');",
        );
      }
    }
    expect(resolve_workspace_runtime_entry(directory, "@lg/workspace/bootstrap")).toBe(
      path.join(directory, "node_modules/@lg/workspace/start.mjs"),
    );
    expect(resolve_workspace_runtime_entry(directory, "@lg/pdf")).toBe(
      path.join(directory, "node_modules/@lg/pdf/document.mjs"),
    );
    expect(resolve_workspace_runtime_entry(directory, "@lg/pdf/worker")).toBe(
      path.join(directory, "node_modules/@lg/pdf/thread.mjs"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
