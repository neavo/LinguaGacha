import { spawn } from "node:child_process";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { npm } from "@lg/npm";
import { uv } from "@lg/uv";
import { ASR_LANGUAGES, MODELS, MODELS_DIRECTORY, analyze, ready } from "./speech.mjs";

const STDERR_MAX_CHARS = 64 * 1024; // 只保留诊断尾部，避免长转码日志持续占用内存。
const DURATION_TOLERANCE = 0.05; // 重新指定原文件时允许的时长误差（秒）。
// 下载恢复与日志策略由 aria2 执行。
const DOWNLOAD_OPTIONS = Object.freeze([
  "--no-conf",
  "--continue=true",
  "--auto-file-renaming=false",
  "--check-integrity=true",
  "--connect-timeout=30",
  "--timeout=60",
  "--max-tries=3",
  "--retry-wait=3",
  "--file-allocation=none",
  "--summary-interval=5",
  "--enable-color=false",
]);
const CUSTOM_RENDERER = "render.mjs"; // 包内可选的定制渲染。
const ROW_KINDS = ["dialogue", "screen"]; // 对话与画面文字。
const TEXT_SCRIPT = fileURLToPath(new URL("text.py", import.meta.url)); // 画面检测、图集与校准。

/** 第三方依赖装在共享 npm 工程，在用到时才加载，缺失时本文件仍可导入并检查。 */
const PACKAGES = Object.freeze({
  [`ffmpeg-static-electron-v5-${process.platform}-${process.arch}`]: "^5.2.5",
  "sherpa-onnx-node": "^2.0.1",
  jsonrepair: "^3.15.0",
  jszip: "^3.10.2",
});
/** 画面检测的 Python 依赖，固定为实测版本。opencv 由 rapidocr 带入。 */
const PYTHON_PACKAGES = Object.freeze(["rapidocr==3.10.0", "onnxruntime==1.31.1"]);
/** PP-OCRv6 Small 检测模型，只做定位。由 aria2 下载校验，不用 RapidOCR 的自动下载。 */
const DETECTOR = Object.freeze({
  file: path.join(MODELS_DIRECTORY, "ppocr", "v6", "PP-OCRv6_det_small.onnx"),
  url: "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/det/PP-OCRv6_det_small.onnx",
  sha256: "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
});

export const load = async (file) => JSON.parse(await readFile(file, "utf8")); // 读取工作目录中的 JSON 材料。
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value); // 普通对象。

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

/** 列出尚未就绪的依赖与模型。npm 包按共享工程中实际安装的目录判断，Python 包按共享工程的依赖声明判断。 */
export async function missing() {
  const packages = [],
    models = [];
  for (const [name, range] of Object.entries(PACKAGES))
    if (!(await exists(path.join(npm.directory, "node_modules", name, "package.json"))))
      packages.push(`${name}@${range}`);
  const project = path.join(uv.directory, "pyproject.toml");
  const declared = (await exists(project)) ? await readFile(project, "utf8") : "";
  // `uv run` 会按声明同步环境，读声明比启动一次 Python 快得多。
  const python = PYTHON_PACKAGES.filter((spec) => !declared.includes(`"${spec}"`));
  for (const model of [...Object.values(MODELS), DETECTOR])
    if (!(await ready(model))) models.push(model);
  return { packages, python, models };
}

/** 安装缺失依赖。aria2 校验通过后发布模型，中断保留临时文件供续传。 */
export async function setup() {
  const { packages, python, models } = await missing();
  if (packages.length) await npm.run(["install", ...packages]);
  if (python.length) await uv.run(["add", ...PYTHON_PACKAGES]);
  for (const model of models) {
    await mkdir(path.dirname(model.file), { recursive: true });
    const temporary = model.file + ".tmp";
    await execute(
      "aria2c",
      [
        ...DOWNLOAD_OPTIONS,
        `--checksum=sha-256=${model.sha256}`,
        "--dir",
        path.dirname(temporary),
        "--out",
        path.basename(temporary),
        model.url,
      ],
      { stdout: "inherit" },
    );
    await rename(temporary, model.file);
  }
  return missing();
}

/** 外部工具共用日志与收尾。工作区宿主负责停止进程树和控制超时。 */
async function execute(binary, args, { check = true, consume, stdout = "ignore" } = {}) {
  const child = spawn(binary, args, {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", consume ? "pipe" : stdout, "pipe"],
  });
  let stderr = "",
    failure;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text) => {
    stderr = (stderr + text).slice(-STDERR_MAX_CHARS);
  });
  const closed = new Promise((resolve) => {
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code) => resolve(code));
  });
  try {
    if (consume) await consume(child.stdout);
    const code = await closed;
    if (failure) throw new Error(`${path.basename(binary)} 启动失败`, { cause: failure });
    if (code === null || (check && code !== 0))
      throw new Error(`${path.basename(binary)} 失败 (${code})：${stderr}`);
    return stderr;
  } finally {
    // 消费 PCM 失败时也等待原生进程退出，再允许调用者继续处理文件。
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
}

/** 随附 ffmpeg 的路径，Node 与 Python 两侧共用。 */
async function ffmpeg_path() {
  const { default: binary } = await import(
    `ffmpeg-static-electron-v5-${process.platform}-${process.arch}`
  );
  return binary.path;
}

/** 截帧、提取字幕与转码共用二进制入口，参数直接传给 ffmpeg。 */
export async function ffmpeg(args, options) {
  return execute(await ffmpeg_path(), ["-hide_banner", "-nostdin", ...args], options);
}

/** 读取时间轴与流信息，封面图片不算视频画面。 */
export async function inspect(source) {
  // 无输出目标时 ffmpeg 返回非零，仍须检查实际读出的媒体信息。
  const text = await ffmpeg(["-i", source], { check: false });
  const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/u.exec(text);
  if (!duration) throw new Error("无法读取媒体时长：" + text);
  const streams = text
    .split(/\r?\n/u)
    .filter((line) => /Stream #\d+:\d+/u.test(line))
    .map((line) => line.trim());
  const video = streams.find((line) => line.includes("Video:") && !line.includes("attached pic"));
  const size = video && /\b(\d{2,})x(\d{2,})\b/u.exec(video);
  if (video && !size) throw new Error("无法读取原视频尺寸");
  return {
    duration: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]),
    video: size ? { width: Number(size[1]), height: Number(size[2]) } : null,
    audio: streams.filter((line) => line.includes("Audio:")),
    subtitles: streams.filter((line) => line.includes("Subtitle:")),
    streams,
  };
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
 * 一次解码完成人声检测与本地识别。
 * 部分容器以音轨起点为零点，补齐起点并保留画面流后与画面检测的零点一致。
 * 5.1、7.1 音轨的对白集中在中置声道，只取该声道识别，实测错误明显少于常规下混。
 */
async function listen(source, stream, track, language) {
  let result;
  await ffmpeg(
    [
      "-v",
      "error",
      "-i",
      source,
      "-map",
      `0:a:${track}`,
      "-af",
      /\b[57]\.1\b/u.test(stream)
        ? "aresample=first_pts=0,pan=mono|c0=FC"
        : "aresample=first_pts=0",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "s16le",
      "pipe:1",
      "-map",
      "0:V:0?",
      "-c",
      "copy",
      "-f",
      "null",
      "-",
    ],
    { consume: async (stream) => (result = await analyze(stream, language)) },
  );
  return result;
}

/** 运行 `text.py` 的子命令。`uv.run` 不能读 stdin、输出只进日志，任务与结果都经工作目录中的文件传递。 */
async function python(directory, command, job) {
  const input = path.join(directory, `${command}.job.json`),
    output = path.join(directory, `${command}.result.json`);
  await save(input, job);
  try {
    await uv.run(["run", "python", TEXT_SCRIPT, command, input, output]);
    return await load(output);
  } finally {
    await rm(input, { force: true });
    await rm(output, { force: true });
  }
}

/** 检测所需的原文件与画面参数。 */
async function detection_job(directory, manifest) {
  if (manifest.video === null) throw new Error("纯音频素材没有画面");
  if (!(await ready(DETECTOR))) throw new Error("检测模型缺失或不一致，先按 media.missing() 补齐");
  return {
    ffmpeg: await ffmpeg_path(),
    source: await locate(directory),
    model: DETECTOR.file,
    ...manifest.video,
  };
}

/** 检测整片文字区间并重新生成裁图，不写 `video.json`，由调用者保存。 */
async function detect(directory, manifest) {
  const job = await detection_job(directory, manifest);
  await rm(path.join(directory, "text"), { recursive: true, force: true }); // 区间编号重排，旧裁图不能混用。
  const text = await python(directory, "scan", { ...job, out: directory });
  // 区间终点是末次检测加 1 秒，片尾不足一秒的部分截到时长。
  return text.map((region) => ({
    ...region,
    end: Math.min(region.end, manifest.duration),
  }));
}

/**
 * 以 1 fps 检测整片画面文字，写入 `video.json` 的 `text`，每个区间的代表帧裁图写入 `text/<id>.jpg`。
 * 准备时自动执行。复核已导入的资产时工作目录没有裁图，调用它重新生成，结果与之前一致。
 */
export async function scan(directory) {
  directory = path.resolve(directory);
  const manifestFile = path.join(directory, "video.json");
  const manifest = await load(manifestFile);
  manifest.text = await detect(directory, manifest);
  await save(manifestFile, manifest);
  return { text: manifest.text.length };
}

/**
 * 准备原文条目与证据，不请求付费模型。有音轨时只支持 `ASR_LANGUAGES` 中的原文语言。
 * 来源身份写入 `video.json` 的 `source`，之后按它找回原文件。
 * 音频识别与画面检测同时运行，各自完成后立即保存，中断后用相同参数续跑。
 */
export async function prepare(source, directory, { track = 0, language } = {}) {
  source = path.resolve(source);
  directory = path.resolve(directory);
  const info = await inspect(source);
  if (!Number.isInteger(track) || track < 0 || (info.audio.length && track >= info.audio.length))
    throw new Error("音轨不存在");
  if (info.video === null && !info.audio.length) throw new Error("素材没有音视频流");
  if (info.audio.length && !Object.hasOwn(ASR_LANGUAGES, language))
    throw new Error(
      `本地识别只支持 ${Object.keys(ASR_LANGUAGES).join("、")}，当前原文语言为 ${language}`,
    );
  const identity = {
    ...(await identify(source)),
    track,
    language: language ?? null,
  };
  const manifestFile = path.join(directory, "video.json");
  let manifest;
  if (await exists(manifestFile)) {
    manifest = await load(manifestFile);
    if (
      !record(manifest.source) ||
      Object.entries(identity).some(([key, value]) => manifest.source[key] !== value)
    )
      throw new Error("来源、音轨或语言已变化，请使用新的工作目录");
  } else {
    manifest = { source: identity, duration: info.duration, video: info.video };
    await save(manifestFile, manifest);
  }
  // 两条支路各写各的字段，保存排队进行，避免同时写同一个文件。
  let saving = Promise.resolve();
  const commit = (fields) =>
    (saving = saving.then(() => save(manifestFile, Object.assign(manifest, fields))));
  const results = await Promise.allSettled([
    "asr" in manifest
      ? null
      : info.audio.length
        ? listen(source, info.audio[track], track, language).then(commit)
        : commit({ speech: null, asr: null }),
    "text" in manifest
      ? null
      : info.video
        ? detect(directory, manifest).then((text) => commit({ text }))
        : commit({ text: null }),
  ]);
  // 一条支路失败后仍等另一条保存完毕，续跑才能安全复用同一目录。
  for (const result of results) if (result.status === "rejected") throw result.reason;
  const itemsFile = path.join(directory, "items.json");
  const hasItems = await exists(itemsFile); // 续跑保留已编辑的原文，包括有意清空的记录。
  const items = hasItems
    ? await load(itemsFile)
    : (manifest.asr ?? []).map(({ start, end, text }) => ({
        start,
        end,
        message: text,
        kind: "dialogue",
      }));
  validate_items(items, manifest.duration);
  if (!hasItems) await save(itemsFile, items);
  return {
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
  const { text } = await load(path.join(directory, "video.json"));
  if (!text) throw new Error("没有文字区间");
  const wanted = ids ? new Set(ids) : null;
  const out = path.join(directory, "sheets");
  await rm(out, { recursive: true, force: true });
  return python(directory, "sheet", {
    entries: text
      .filter((region) => !wanted || wanted.has(region.id))
      .map(({ id, start }) => ({
        id,
        start,
        file: path.join(directory, "text", `${id}.jpg`),
      })),
    out,
  });
}

/**
 * 在原文件上以高帧率校准带 `box` 的 `screen` 行的起止时间，直接写回 `items.json`。
 * 边界不在原时间前后 1 秒内时保持原值，这些行在 `unresolved` 中返回。
 */
export async function refine(directory, rows) {
  directory = path.resolve(directory);
  const manifest = await load(path.join(directory, "video.json"));
  const job = await detection_job(directory, manifest);
  const itemsFile = path.join(directory, "items.json");
  const items = await load(itemsFile);
  for (const row of rows)
    if (
      !valid_row(items[row], manifest.duration) ||
      items[row].kind !== "screen" ||
      !items[row].box
    )
      throw new Error(`第 ${row} 行不是带 box 的 screen`);
  const bounds = await python(directory, "refine", {
    ...job,
    duration: manifest.duration,
    rows: rows.map((row) => ({ ...items[row], row })),
  });
  const unresolved = [];
  for (const { row, start, end } of bounds) {
    const next = { ...items[row], start, end };
    // 两个边界都有效才整行采用，未决行保留原时间。
    if (valid_row(next, manifest.duration)) items[row] = next;
    else unresolved.push(row);
  }
  await save(itemsFile, items);
  return { refined: rows.length - unresolved.length, unresolved };
}

/**
 * 按 `video.json` 记录的身份找回原文件。路径不存在或大小、修改时间不一致时报错，
 * 由 Agent 请用户提供新路径后调用 `relink`。
 */
export async function locate(directory) {
  const { source } = await load(path.join(path.resolve(directory), "video.json"));
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
  const manifestFile = path.join(path.resolve(directory), "video.json");
  const manifest = await load(manifestFile);
  const info = await inspect(file);
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

/** `box` 是归一化的 `[x0, y0, x1, y1]`。 */
const valid_box = (box) =>
  Array.isArray(box) &&
  box.length === 4 &&
  box.every((value) => Number.isFinite(value) && 0 <= value && value <= 1) &&
  box[0] < box[2] &&
  box[1] < box[3];

/**
 * 字幕行的结构与时间是否可用。坏时间不能参与排序和区间运算，姓名须符合后端记录契约。
 * `box` 只属于 `screen`，误写到对白上会让渲染不按预期避让。
 */
export function valid_row(row, duration) {
  return (
    record(row) &&
    Number.isFinite(row.start) &&
    Number.isFinite(row.end) &&
    0 <= row.start &&
    row.start < row.end &&
    row.end <= duration &&
    ROW_KINDS.includes(row.kind) &&
    typeof row.message === "string" &&
    row.message.trim() !== "" &&
    (row.name === undefined || typeof row.name === "string") &&
    (row.box === undefined || (row.kind === "screen" && valid_box(row.box)))
  );
}

/** 保留数组坐标，坏记录必须整批修正，不能过滤或排序后悄悄改变译文归属。 */
function validate_items(items, duration) {
  if (!Array.isArray(items)) throw new Error("items.json 必须是数组");
  const invalid = items.findIndex((item) => !valid_row(item, duration));
  if (invalid !== -1)
    throw new Error(`items.json 第 ${invalid} 行不合法：${JSON.stringify(items[invalid])}`);
}

/**
 * 校验原文记录并打包，失败时保留已有完整包。包里只有 JSON 和可选的定制渲染，媒体按 `source` 找回。
 * 数组顺序即提交后的 `row_number`。
 */
export async function pack(directory, output) {
  const { default: JSZip } = await import("jszip");
  const manifest = await load(path.join(directory, "video.json"));
  const items = await load(path.join(directory, "items.json"));
  validate_items(items, manifest.duration);
  const members = ["video.json", "items.json"];
  if (await exists(path.join(directory, CUSTOM_RENDERER))) members.push(CUSTOM_RENDERER);
  const zip = new JSZip();
  for (const member of members) zip.file(member, await readFile(path.join(directory, member)));
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = output + ".tmp.video";
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
