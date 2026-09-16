import { copyFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const resources = path.join(root, "resources/workspace");
const output = path.resolve(process.argv[2] ?? resources); // 测试可在仓库外使用同一部署流程

// 预加载程序自包含；构建仅覆盖生成物，资源目录中的清单与锁文件由版本管理拥有。
await build({
  configFile: false,
  publicDir: false,
  build: {
    target: "node24",
    outDir: output,
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: path.join(root, "src/backend/agent/workspace/runtime/bootstrap.ts"),
      formats: ["es"],
      fileName: () => "bootstrap.mjs",
    },
    rolldownOptions: {
      platform: "node",
      external: [...builtinModules, /^node:/u],
      output: { codeSplitting: false },
    },
  },
});
if (output !== resources) {
  for (const name of ["package.json", "package-lock.json"]) {
    await copyFile(path.join(resources, name), path.join(output, name));
  }
}
await execa("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: output,
  stdio: "inherit",
  windowsHide: true,
});
