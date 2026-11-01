import path from "node:path";
import { expect, it } from "vitest";
import { build_resources } from "./build.mjs";

it("整体重建拒绝覆盖项目和依赖安装源", async () => {
  const root = path.resolve("fixture-source");
  for (const output of [
    root,
    path.dirname(root),
    path.join(root, "src"),
    path.join(root, "build"),
    path.join(root, "node_modules/runtime"),
  ]) {
    await expect(build_resources({ root, output })).rejects.toThrow("overlaps its source");
  }
  if (process.platform === "win32") {
    await expect(
      build_resources({ root, output: path.join(root, "NODE_MODULES/runtime") }),
    ).rejects.toThrow("overlaps its source");
  }
});
