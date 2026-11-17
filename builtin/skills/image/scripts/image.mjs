import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import * as generic from "@lg/generic";
import * as sdk from "@lg/image";

export {
  DeviceFailure,
  IMAGE_DEPENDENCIES,
  describe_package,
  missing_models,
  prepare_models,
} from "@lg/image";

/** 新图片经应用计算后，由 skill 构造唯一的当前包材料。 */
export async function prepare(sources, directory, { device = "gpu" } = {}) {
  const result = await sdk.processPages(sources, directory, device);
  const records = sdk.read_image_records(result.pages.flatMap((item) => item.records));
  const book = sdk.read_image_book(
    { bookId: randomUUID(), pages: result.pages.map((item) => item.page) },
    records,
  );
  const clean = sdk.read_image_clean(
    { bookId: book.bookId, pages: result.pages.map((item) => item.clean) },
    book,
  );
  await save(path.join(result.package_directory, "image.json"), book);
  await save(path.join(result.package_directory, "items.json"), records);
  await save(path.join(result.package_directory, "clean.json"), clean);
  return {
    directory: result.directory,
    package_directory: result.package_directory,
    items: records.length,
    pages: result.pages.map(({ page, diagnostics }) => ({
      page_id: page.pageId,
      relative_path: page.relativePath,
      preview_path: diagnostics.preview,
      detected: diagnostics.detected,
      regions: diagnostics.regions,
      failures: diagnostics.failures.map((failure) => ({
        region_id: failure.regionId,
        message: failure.error,
      })),
    })),
  };
}

/** 旧图片包只安全展开，Agent 在 `package/` 中按实际语义构造当前材料。 */
export async function unpack(source, directory) {
  directory = path.resolve(directory);
  const packageDirectory = path.join(directory, "package");
  const result = await generic.unpack(source, packageDirectory);
  return { directory, package_directory: packageDirectory, members: result.members };
}

/** 读取并校验工作目录中的当前三个 JSON。 */
export async function read(directory) {
  const packageDirectory = path.join(path.resolve(directory), "package");
  const records = sdk.read_image_records(await load(path.join(packageDirectory, "items.json")));
  const book = sdk.read_image_book(await load(path.join(packageDirectory, "image.json")), records);
  const clean = sdk.read_image_clean(await load(path.join(packageDirectory, "clean.json")), book);
  return { book, records, clean };
}

/** 当前材料通过领域物理校验后，交给基础容器原子封包。 */
export async function pack(directory, output) {
  const packageDirectory = path.join(path.resolve(directory), "package");
  const current = await sdk.validate_package(packageDirectory);
  const result = await generic.pack(packageDirectory, output);
  return {
    package: result.output_path,
    pages: current.book.pages.length,
    items: current.records.length,
    members: result.members,
  };
}

/** 保存可重建的当前包材料。 */
async function save(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2));
}

/** 工作材料只按 UTF-8 JSON 读取。 */
async function load(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
