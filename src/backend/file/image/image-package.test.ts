import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { expect, it } from "vitest";

import { unpack } from "../../agent/generic/package";
import { image_fixture } from "../../../test/image-fixture";
import { validate_image_package_directory } from "./image-package";

it("工作目录与归档执行同一当前图片物理契约", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-package-"));
  const source = path.join(temporary.path, "source.image");
  const directory = path.join(temporary.path, "package");
  await writeFile(source, await image_fixture(["page"]).pack());
  await unpack(source, directory);

  await expect(validate_image_package_directory(directory)).resolves.toMatchObject({
    book: { pages: [{ pageId: "page" }] },
    records: [{ pageId: "page", message: "うん" }],
  });
});
