import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build_resources } from "../resources/build.mjs";

/** 每次测试运行独占资源目录，测试只读共享产物，修改部署内容的场景自行复制。 */
export default async function setup(project) {
  const deployed = process.env.LINGUAGACHA_TEST_WORKSPACE_RUNTIME;
  if (deployed) {
    project.provide("workspaceRuntimeDirectory", path.resolve(deployed));
    return;
  }
  const root = project.config.root;
  const resources = await mkdtemp(path.join(os.tmpdir(), "lg-test-resources-"));
  const workspace = path.join(resources, "workspace");
  const cleanup = () => rm(resources, { recursive: true, force: true }); // 只回收本次创建的资源。
  try {
    if (project.name === "integration") {
      await build_resources({ root, output: resources, development: true });
      await cp(path.join(root, "public/fonts"), path.join(resources, "fonts"), { recursive: true });
    } else {
      // 普通测试只消费解析器和语法 WASM，避免完整部署的准备开销。
      await mkdir(path.join(workspace, "python"), { recursive: true });
      await cp(
        path.join(root, "node_modules/web-tree-sitter"),
        path.join(workspace, "node_modules/web-tree-sitter"),
        { recursive: true },
      );
      await cp(
        path.join(root, "node_modules/tree-sitter-python/tree-sitter-python.wasm"),
        path.join(workspace, "python/tree-sitter-python.wasm"),
      );
    }
    project.provide("workspaceRuntimeDirectory", workspace);
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
