import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { build_node_resources } from "./node.mjs";

it("npm 种子的清单、锁文件和安装树只包含用户依赖", async () => {
  const root = process.cwd();
  const output = await mkdtemp(path.join(os.tmpdir(), "lg-node-resources-"));
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
  try {
    await build_node_resources({
      root,
      output,
      manifest,
      lock,
      runNpm: (cwd, args) =>
        execFileSync(
          process.execPath,
          [path.join(root, "node_modules/npm/bin/npm-cli.js"), ...args],
          { cwd, windowsHide: true, stdio: "pipe" },
        ),
    });
    for (const [file, field] of [
      ["package.json", "dependencies"],
      ["package-lock.json", "packages"],
    ]) {
      const value = JSON.parse(await readFile(path.join(output, "seed", file), "utf8"));
      expect(
        Object.keys(value[field]).filter((name) => /(?:^|\/)@lg\/|(?:^|\/)mupdf$/u.test(name)),
      ).toEqual([]);
    }
    const modules = await readdir(path.join(output, "seed/node_modules"));
    expect(modules).not.toContain("@lg");
    expect(modules).not.toContain("mupdf");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}, 60_000);
