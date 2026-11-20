import { render_book } from "./render.mjs";
import path from "node:path";

import * as generic from "@lg/generic";
import * as sdk from "@lg/image";

export { DeviceFailure, missing_models, prepare_models } from "@lg/image";

export const NPM_DEPENDENCIES = ["onnxruntime-node@1.30.0"];
export const PIP_DEPENDENCIES = [
  "numpy==2.5.5",
  "opencv-python-headless==5.1.0.95",
  "pillow==13.0.0",
  "pyclipper==1.4.0",
];

const pipeline = sdk.create_image_pipeline(new URL("./helper.py", import.meta.url));
const { scan, prepare, inspectGroup, repartition } = pipeline;
export { scan, inspectGroup };

/** 将指定气泡切换为分格排版。 */
export function splitBubble(directory, target) {
  return sdk.set_image_bubble_layout(directory, target, "split");
}

/** 将指定气泡切换为整泡排版。 */
export function mergeBubble(directory, target) {
  return sdk.set_image_bubble_layout(directory, target, "whole");
}

/** 将确认的字号写入准备目录。 */
export function setFontSizes(directory, fontSizes) {
  sdk.set_image_font_sizes(directory, fontSizes);
}

/** 原子生成译图、双语双拼图、QA 对照图与 report.json 报告，默认渲染整册。 */
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

/** 读取准备目录的清单和原文。 */
export function read(directory) {
  return sdk.read_image_package_manifest(path.resolve(directory, "package"));
}

/** 带上归档位置与成员数。清单由工作目录的入口核对。 */
async function write_package(directory, output) {
  const { output_path, members } = await generic.pack(path.resolve(directory, "package"), output);
  return { package: output_path, members };
}

/** 根据工作目录清单封包，入库时核对成员集合。 */
export async function pack(directory, output) {
  const { book } = read(directory);
  return {
    ...(await write_package(directory, output)),
    pages: book.pages.length,
    items: sdk.select_image_regions(book).size,
  };
}

/** 准备消字补丁与排版掩码，并原子封装为 .image 资产包。 */
export async function prepareAndPack(directory, selected, output, archive, options) {
  const prepared = await prepare(directory, selected, output, options);
  return { ...prepared, ...(await write_package(prepared.directory, archive)) };
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
  return { ...prepared, ...(await write_package(prepared.directory, archive)) };
}
