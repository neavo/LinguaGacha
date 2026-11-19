import { render_book } from "./render.mjs";
import path from "node:path";

import * as generic from "@lg/generic";
import * as sdk from "@lg/image";

export {
  DeviceFailure,
  IMAGE_DEPENDENCIES,
  IMAGE_PIXEL_DEPENDENCIES,
  missing_models,
  prepare_models,
} from "@lg/image";

const pipeline = sdk.create_image_pipeline(new URL("./helper.py", import.meta.url));
const { scan, prepare, inspectGroup, repartition } = pipeline;
export { scan, inspectGroup };

/** 登记将指定气泡切换为分格版本的条目意图，目标可用整泡或任一子格编号。 */
export function splitBubble(target) {
  return sdk.queue_image_bubble_layout(process.cwd(), target, "split");
}

/** 登记将指定气泡切换为整泡版本的条目意图，目标可用整泡或任一子格编号。 */
export function mergeBubble(target) {
  return sdk.queue_image_bubble_layout(process.cwd(), target, "whole");
}

/** 渲染整册译图，原子生成译图、QA 对照图与 report.json 报告。 */
export function render(options) {
  return render_book(options, pipeline);
}

/** 旧图片包只安全展开，Agent 在 `package/` 中按实际语义构造当前材料。 */
export async function unpack(source, directory) {
  directory = path.resolve(directory);
  const packageDirectory = path.join(directory, "package");
  const result = await generic.unpack(source, packageDirectory);
  return { directory, package_directory: packageDirectory, members: result.members };
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

/** 准备消字补丁与排版掩码，并原子封装为 .image 资产包。 */
export async function prepareAndPack(directory, selected, output, archive, options) {
  const prepared = await prepare(directory, selected, output, options);
  return { ...prepared, ...(await pack(prepared.directory, archive)) };
}

/** 重新划分连体气泡格界，并原子封装为 .image 资产包。 */
export async function repartitionAndPack(
  directory,
  correction,
  previous,
  output,
  archive,
  options,
) {
  const prepared = await repartition(directory, correction, previous, output, options);
  return { ...prepared, ...(await pack(prepared.directory, archive)) };
}
