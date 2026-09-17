import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 用独立模块编译生成声明及调用样例，同时验证其中的 @ts-expect-error 反例。 */
export function check_typescript(sources: readonly string[]): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-types-"));
  try {
    const files = sources.map((source, index) => {
      const file = path.join(directory, `${index.toString()}.ts`);
      fs.writeFileSync(file, `export {};\n${source}`);
      return file;
    });
    execFileSync(
      process.execPath,
      [
        path.resolve("node_modules/typescript/lib/tsc.js"),
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--module",
        "ESNext",
        "--moduleResolution",
        "bundler",
        "--target",
        "ESNext",
        "--lib",
        "ESNext,DOM",
        ...files,
      ],
      { windowsHide: true },
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
