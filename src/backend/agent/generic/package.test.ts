import { mkdir, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { pack, unpack } from "./package";

it("基础容器往返保留成员并拒绝覆盖现有目标", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-package-"));
  const source = path.join(temporary.path, "source");
  const output = path.join(temporary.path, "data.generic");
  const extracted = path.join(temporary.path, "extracted");
  await mkdir(path.join(source, "assets"), { recursive: true });
  await writeFile(path.join(source, "items.json"), '[{"message":"text"}]');
  await writeFile(path.join(source, "assets", "source.txt"), "original");

  await expect(pack(source, output)).resolves.toMatchObject({ members: 2 });
  await expect(unpack(output, extracted)).resolves.toMatchObject({
    members: ["assets/source.txt", "items.json"],
  });
  expect(await readFile(path.join(extracted, "assets", "source.txt"), "utf8")).toBe("original");
  await expect(pack(source, output)).rejects.toThrow("already exists");
  await expect(unpack(output, extracted)).rejects.toThrow("already exists");
});
