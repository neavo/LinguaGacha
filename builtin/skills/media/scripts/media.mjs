import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import * as sdk from "@lg/media";
import { npm } from "@lg/npm";

// 依赖由 AGENT 经 npm、uv 显式准备，设备在每次推理调用中明确传入。
export {
  ASR_LANGUAGES,
  DeviceFailure,
  ffmpeg,
  inspect,
  missing_models,
  prepare_models,
} from "@lg/media";

// 已验收的依赖版本，由 AGENT 经 npm、uv 显式安装，不随任务升级。
export const DEPENDENCIES = Object.freeze({
  npm: [
    `ffmpeg-static-electron-v5-${process.platform}-${process.arch}@5.2.5`,
    `onnxruntime-node@${sdk.INFERENCE_DEPENDENCIES.ort}`, // 1.31.1 存在宿主退出卡住问题，固定已通过退出验收的版本。
  ],
  python: [
    `numpy==${sdk.INFERENCE_DEPENDENCIES.numpy}`,
    "kaldi-native-fbank==1.23.0",
    `opencv-python-headless==${sdk.INFERENCE_DEPENDENCIES.opencv}`,
    `pyclipper==${sdk.INFERENCE_DEPENDENCIES.pyclipper}`,
  ],
});

const DURATION_TOLERANCE = 0.05; // 重新指定原文件时允许的时长误差（秒）。
const CUSTOM_RENDERER = "render.mjs"; // 包内可选的定制渲染。
export const load = async (file) => JSON.parse(await readFile(file, "utf8")); // 读取工作目录中的 JSON 材料。
export const read_work_manifest = async (file) => sdk.read_media_work_manifest(await load(file));
export const read_package_manifest = async (file) =>
  sdk.read_media_package_manifest(await load(file));
export const read_items = async (file, duration, video) =>
  sdk.read_media_items(await load(file), duration, video);

/** 只有缺失表示尚未生成，权限与其他 IO 错误保留。 */
export async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** 原子发布 JSON，续跑只读取完整结果。 */
export async function save(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2));
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** 按需安装本技能脚本自己的 npm 依赖。媒体计算依赖见技能「环境准备」。 */
export async function install(name, range) {
  if (!(await exists(path.join(npm.directory, "node_modules", name, "package.json"))))
    await npm.run(["install", `${name}@${range}`]);
}

/** 原文件身份。纳秒用字符串保存，避免 JSON 数字丢失精度。 */
async function identify(file) {
  const details = await stat(file, { bigint: true });
  return {
    path: file,
    size: Number(details.size),
    mtime_ns: String(details.mtimeNs),
  };
}

/**
 * 检测完成后替换裁图，由调用者发布清单；清单失败时恢复旧裁图。
 * 计算失败时保留原有裁图。
 */
async function detect(directory, options, commit) {
  const staging = path.join(directory, "text.staging");
  const text = await sdk.scan(await locate(directory), { out: staging, ...options });
  const crops = path.join(directory, "text");
  const backup = path.join(directory, "text.previous");
  // 清单发布失败时恢复旧裁图，避免原区间编号指向新图片。
  await rm(backup, { recursive: true, force: true });
  const hadCrops = await exists(crops);
  if (hadCrops) await rename(crops, backup);
  try {
    await rename(staging, crops);
    await commit({ text });
  } catch (error) {
    await rm(crops, { recursive: true, force: true });
    if (hadCrops) await rename(backup, crops);
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}

/**
 * 以 1 fps 检测并识别画面文字，按位置和内容分段。
 * 区间写入 `media.json` 的 `text`，代表裁图写入 `text/<id>.jpg`。
 * 准备时自动执行。复核已导入的资产时工作目录没有裁图，调用它重新生成。
 * 检测与识别模型随指定设备而定，区间编号和框只在本次结果内有效。
 */
export async function scan(directory, { device } = {}) {
  directory = path.resolve(directory);
  const manifestFile = path.join(directory, "media.json");
  const manifest = await read_work_manifest(manifestFile);
  if (manifest.video === null) throw new Error("纯音频素材没有画面");
  await detect(directory, { device }, async (fields) => {
    await save(manifestFile, { ...manifest, ...fields });
    Object.assign(manifest, fields);
  });
  return { text: manifest.text.length };
}

/**
 * 准备原文条目与证据，不请求付费模型。有音轨时只支持 `ASR_LANGUAGES` 中的原文语言。
 * 来源身份写入 `media.json` 的 `source`，之后按它找回原文件。
 * 音频识别与画面检测同时运行，各自完成后立即保存，中断后用相同参数续跑。
 * `device` 必须是 `cpu` 或 `gpu`，只按该设备执行，失败后由调用者决定是否换设备续跑。
 */
export async function prepare(source, directory, { track = 0, language, device, rerun = [] } = {}) {
  source = path.resolve(source);
  directory = path.resolve(directory);
  if (!Array.isArray(rerun) || rerun.some((step) => !["speech", "text"].includes(step)))
    throw new Error("rerun 只接受 speech、text");
  if (!["cpu", "gpu"].includes(device)) throw new Error("device 只接受 cpu、gpu");
  const info = await sdk.inspect(source);
  if (!Number.isInteger(track) || track < 0 || (info.audio.length && track >= info.audio.length))
    throw new Error("音轨不存在");
  if (info.video === null && !info.audio.length) throw new Error("素材没有音视频流");
  if (info.audio.length && !Object.hasOwn(sdk.ASR_LANGUAGES, language))
    throw new Error(
      `本地识别只支持 ${Object.keys(sdk.ASR_LANGUAGES).join("、")}，当前原文语言为 ${language}`,
    );
  const identity = {
    ...(await identify(source)),
    track,
    language: language ?? null,
  };
  const manifestFile = path.join(directory, "media.json");
  let manifest;
  if (await exists(manifestFile)) {
    manifest = await read_work_manifest(manifestFile);
    if (Object.entries(identity).some(([key, value]) => manifest.source[key] !== value))
      throw new Error("来源、音轨或语言已变化，请使用新的工作目录");
  } else {
    manifest = {
      source: identity,
      duration: info.duration,
      video: info.video,
    };
    await save(manifestFile, manifest);
  }
  // 分支只在结果完整后发布，保存排队避免同时覆盖清单。
  let saving = Promise.resolve();
  const commit = (fields) =>
    (saving = saving.then(async () => {
      await save(manifestFile, { ...manifest, ...fields });
      Object.assign(manifest, fields);
    }));
  const steps = { speech: "reused", text: "reused" };
  const results = await Promise.allSettled([
    "asr" in manifest && !rerun.includes("speech")
      ? null
      : info.audio.length
        ? sdk.listen(source, { track, language, device }).then(async (result) => {
            await commit(result);
            steps.speech = rerun.includes("speech") ? "rerun" : "executed";
          })
        : commit({ speech: null, asr: null }).then(() => {
            steps.speech = "skipped";
          }),
    "text" in manifest && !rerun.includes("text")
      ? null
      : info.video
        ? detect(directory, { device }, commit).then(() => {
            steps.text = rerun.includes("text") ? "rerun" : "executed";
          })
        : commit({ text: null }).then(() => {
            steps.text = "skipped";
          }),
  ]);
  // 一条支路失败后仍等另一条保存完毕，续跑才能安全复用同一目录。
  const failures = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  // 保留每条失败，关闭错误不能被另一支的设备或文件错误遮蔽。
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "媒体并行处理失败，请检查全部分支错误");
  const itemsFile = path.join(directory, "items.json");
  const hasItems = await exists(itemsFile); // 续跑保留已编辑的原文，包括有意清空的记录。
  const items = hasItems
    ? await read_items(itemsFile, manifest.duration, manifest.video)
    : sdk.read_media_items(
        (manifest.asr ?? []).map(({ start, end, text }) => ({
          start,
          end,
          message: text,
          kind: "dialogue",
        })),
        manifest.duration,
        manifest.video,
      );
  if (!hasItems) await save(itemsFile, items);
  return {
    steps,
    items: items.length,
    speech: manifest.speech?.length ?? null,
    asr: manifest.asr?.length ?? null,
    text: manifest.text?.length ?? null,
  };
}

/**
 * 把文字区间的代表帧裁图拼成图集，供 `ws.emitImage` 查看。省略 `ids` 时包含全部区间。
 * 返回 `[{ file, ids }]`，每张图集不超过 1280×1280。
 */
export async function sheets(directory, { ids } = {}) {
  directory = path.resolve(directory);
  const { text } = await read_work_manifest(path.join(directory, "media.json"));
  if (!text) throw new Error("没有文字区间");
  const wanted = ids ? new Set(ids) : null;
  const out = path.join(directory, "sheets");
  await rm(out, { recursive: true, force: true });
  return sdk.sheets(
    text
      .filter((region) => !wanted || wanted.has(region.id))
      .map(({ id, start }) => ({ id, start, file: path.join(directory, "text", `${id}.jpg`) })),
    out,
  );
}

/**
 * 在原文件上以 4 fps 校准带 `box` 的 `screen` 行的同内容边界，直接写回 `items.json`。
 * 边界不在原时间前后 1 秒内时保持原值，这些行在 `unresolved` 中返回。
 */
export async function refine(directory, rows, { device } = {}) {
  directory = path.resolve(directory);
  const manifest = await read_work_manifest(path.join(directory, "media.json"));
  if (manifest.video === null) throw new Error("纯音频素材没有画面");
  const itemsFile = path.join(directory, "items.json");
  const items = await read_items(itemsFile, manifest.duration, manifest.video);
  for (const row of rows) {
    const item = items[row];
    if (!item || item.kind !== "screen" || !item.box)
      throw new Error(`第 ${row} 行不是带 box 的 screen`);
  }
  const bounds = await sdk.refine(await locate(directory), {
    device,
    rows: rows.map((row) => ({ ...items[row], row })),
  });
  const unresolved = [];
  for (const { row, start, end } of bounds) {
    const next = { ...items[row], start, end };
    // 两个边界都有效才整行采用，未决行保留原时间。
    if (valid_row(next, manifest.duration, manifest.video)) items[row] = next;
    else unresolved.push(row);
  }
  await save(itemsFile, items);
  return { refined: rows.length - unresolved.length, unresolved };
}

/**
 * 按 `media.json` 记录的身份找回原文件。路径不存在或大小、修改时间不一致时报错，
 * 由 Agent 请用户提供新路径后调用 `relink`。
 */
export async function locate(directory) {
  const { source } = await read_work_manifest(path.join(path.resolve(directory), "media.json"));
  let current = null;
  try {
    current = await identify(source.path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (current?.size !== source.size || current.mtime_ns !== source.mtime_ns)
    throw new Error(`原文件 ${source.path} 不存在或已变化，请用户提供新路径后调用 media.relink()`);
  return source.path;
}

/** 改用新的原文件路径。核对时长、画面尺寸和所选音轨后更新身份。 */
export async function relink(directory, file) {
  file = path.resolve(file);
  const manifestFile = path.join(path.resolve(directory), "media.json");
  const manifest = await read_work_manifest(manifestFile);
  const info = await sdk.inspect(file);
  if (
    Math.abs(info.duration - manifest.duration) > DURATION_TOLERANCE ||
    JSON.stringify(info.video) !== JSON.stringify(manifest.video)
  )
    throw new Error("新文件的时长或画面尺寸与原素材不一致");
  if (manifest.asr !== null && !info.audio[manifest.source.track])
    throw new Error("新文件缺少原来选择的音轨");
  manifest.source = { ...manifest.source, ...(await identify(file)) };
  await save(manifestFile, manifest);
  return manifest.source;
}

/**
 * 字幕行的结构与时间是否可用。坏时间不能参与排序和区间运算，姓名须符合后端记录契约。
 * `box` 只属于 `screen`，误写到对白上会让渲染不按预期避让。
 */
export function valid_row(row, duration, video = { width: 1, height: 1 }) {
  try {
    sdk.read_media_items([row], duration, video);
    return true;
  } catch {
    return false;
  }
}

/**
 * 校验原文记录并打包，失败时保留已有完整包。包里只有 JSON 和可选的定制渲染，媒体按 `source` 找回。
 * 数组顺序即提交后的 `row_number`。
 */
export async function pack(directory, output) {
  await install("jszip", "^3.10.2");
  const { default: JSZip } = await import("jszip");
  const manifest = await read_package_manifest(path.join(directory, "media.json"));
  const items = await read_items(
    path.join(directory, "items.json"),
    manifest.duration,
    manifest.video,
  );
  const zip = new JSZip();
  zip.file("media.json", JSON.stringify(manifest, null, 2));
  zip.file("items.json", JSON.stringify(items, null, 2));
  if (await exists(path.join(directory, CUSTOM_RENDERER)))
    zip.file(CUSTOM_RENDERER, await readFile(path.join(directory, CUSTOM_RENDERER)));
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = output + ".tmp.media";
  try {
    await writeFile(
      temporary,
      await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    );
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  return { package: output, items: items.length };
}
