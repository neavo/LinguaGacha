import { readFile } from "node:fs/promises";
import path from "node:path";

import * as generic from "@lg/generic";
import * as sdk from "@lg/image";

export {
  DeviceFailure,
  IMAGE_DEPENDENCIES,
  describe_package,
  missing_models,
  prepare_models,
  scanPages as scan,
  preparePages as prepare,
  inspectBubbleGroup as inspectGroup,
  repartitionBubbleGroup as repartition,
} from "@lg/image";

/** 旧图片包只安全展开，Agent 在 `package/` 中按实际语义构造当前材料。 */
export async function unpack(source, directory) {
  directory = path.resolve(directory);
  const packageDirectory = path.join(directory, "package");
  const result = await generic.unpack(source, packageDirectory);
  return { directory, package_directory: packageDirectory, members: result.members };
}

/** 读取并校验工作目录中的当前两个 JSON。 */
export async function read(directory) {
  const packageDirectory = path.join(path.resolve(directory), "package");
  const records = sdk.read_image_records(await load(path.join(packageDirectory, "items.json")));
  const book = sdk.read_image_book(await load(path.join(packageDirectory, "image.json")), records);
  return { book, records };
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
async function load(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
