import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Arch } from "builder-util";
import JSZip from "jszip";

const builder_dir = path.dirname(fileURLToPath(import.meta.url));
const default_project_dir = path.resolve(builder_dir, "../..");
const manifest_path = path.join(builder_dir, "deno-runtime-manifest.json");

/** 读取版本与目标资产权威，目标字段在实际选择时继续收窄。 */
export async function read_deno_runtime_manifest(file_path = manifest_path) {
  const value = JSON.parse(await fs.readFile(file_path, "utf8"));
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.version !== "string" ||
    typeof value.releaseBaseUrl !== "string" ||
    typeof value.targets !== "object" ||
    value.targets === null
  ) {
    throw new Error(`Invalid Deno runtime manifest: ${file_path}.`);
  }
  return value;
}

/** electron-builder 的平台和架构只允许映射到 manifest 中的六个发布目标。 */
export function resolve_deno_target(manifest, platform, arch) {
  const arch_name = resolve_arch_name(arch);
  const key = `${platform}-${arch_name ?? String(arch)}`;
  const target = manifest.targets[key];
  if (target === undefined) throw new Error(`Unsupported Deno release target: ${key}.`);
  for (const field of ["asset", "assetSha256", "binarySha256", "binary"]) {
    if (typeof target[field] !== "string" || target[field] === "") {
      throw new Error(`Deno runtime manifest target ${key} is missing ${field}.`);
    }
  }
  return { key, ...target };
}

/** 开发态只准备当前宿主的固定版本二进制，不查询系统 PATH。 */
export async function prepare_deno_runtime_for_development(options = {}) {
  const project_dir = options.projectDir ?? default_project_dir;
  const manifest = options.manifest ?? (await read_deno_runtime_manifest());
  const target = resolve_deno_target(
    manifest,
    options.platform ?? process.platform,
    options.arch ?? process.arch,
  );
  const destination_dir = path.join(project_dir, "resources", "deno");
  return await install_deno_binary({
    projectDir: project_dir,
    destinationDir: destination_dir,
    manifest,
    target,
    fetchImpl: options.fetchImpl ?? fetch,
  });
}

/** afterPack 把目标二进制与 runtime bundle 安装到 resources/deno。 */
export async function install_packaged_deno_runtime(context, options = {}) {
  const project_dir = context.packager?.projectDir ?? default_project_dir;
  const manifest = options.manifest ?? (await read_deno_runtime_manifest());
  const target = resolve_deno_target(manifest, context.electronPlatformName, context.arch);
  if (typeof context.packager?.getResourcesDir !== "function") {
    throw new Error("electron-builder context is missing packager.getResourcesDir.");
  }
  const resources_dir = context.packager.getResourcesDir(context.appOutDir);
  const destination_dir = path.join(resources_dir, "deno");
  await install_deno_binary({
    projectDir: project_dir,
    destinationDir: destination_dir,
    manifest,
    target,
    fetchImpl: options.fetchImpl ?? fetch,
  });
  const runtime_entry = path.join(project_dir, "resources", "deno", "deno-runtime.js");
  await assert_regular_file(runtime_entry, "Agent Workspace runtime bundle");
  await fs.copyFile(runtime_entry, path.join(destination_dir, "deno-runtime.js"));
}

/** 复用校验通过的目标文件，否则经双重 hash 校验安装当前目标。 */
async function install_deno_binary({ projectDir, destinationDir, manifest, target, fetchImpl }) {
  const executable_path = path.join(destinationDir, target.binary);
  if (await file_has_sha256(executable_path, target.binarySha256)) {
    if (target.binary !== "deno.exe") await fs.chmod(executable_path, 0o755);
    return executable_path;
  }

  const cache_dir = path.join(projectDir, "build", "cache", "deno", manifest.version);
  const archive_path = path.join(cache_dir, target.asset);
  await fs.mkdir(cache_dir, { recursive: true });
  if (!(await file_has_sha256(archive_path, target.assetSha256))) {
    await fs.rm(archive_path, { force: true });
    await download_archive(
      `${manifest.releaseBaseUrl}/${target.asset}`,
      archive_path,
      target.assetSha256,
      fetchImpl,
    );
  }
  const archive = await JSZip.loadAsync(await fs.readFile(archive_path));
  const binary_entry = archive.file(target.binary);
  if (binary_entry === null) throw new Error(`Deno archive is missing ${target.binary}.`);
  const binary = await binary_entry.async("nodebuffer");
  const binary_sha256 = sha256(binary);
  if (binary_sha256 !== target.binarySha256) {
    throw new Error(
      `Deno binary SHA-256 mismatch: expected ${target.binarySha256}, received ${binary_sha256}.`,
    );
  }
  await fs.mkdir(destinationDir, { recursive: true });
  await install_binary(executable_path, binary, target.binary !== "deno.exe");
  return executable_path;
}

/** 完整校验后再替换目标文件，构建中断不会留下半写入的可执行文件。 */
async function install_binary(executable_path, binary, set_executable_mode) {
  const temporary_path = `${executable_path}.${process.pid.toString()}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary_path, binary, { flag: "wx", mode: 0o755 });
    if (set_executable_mode) await fs.chmod(temporary_path, 0o755);
    await fs.rename(temporary_path, executable_path);
  } catch (error) {
    await fs.rm(temporary_path, { force: true });
    throw error;
  }
}

/** 下载内容先写唯一临时文件，校验通过后才进入版本缓存。 */
async function download_archive(url, archive_path, expected_sha256, fetch_impl) {
  const temporary_path = `${archive_path}.${process.pid.toString()}.${crypto.randomUUID()}.tmp`;
  try {
    const response = await fetch_impl(url);
    if (!response.ok) throw new Error(`Downloading Deno failed with HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual_sha256 = sha256(bytes);
    if (actual_sha256 !== expected_sha256) {
      throw new Error(
        `Deno archive SHA-256 mismatch: expected ${expected_sha256}, received ${actual_sha256}.`,
      );
    }
    await fs.writeFile(temporary_path, bytes, { flag: "wx" });
    await fs.rename(temporary_path, archive_path);
  } catch (error) {
    await fs.rm(temporary_path, { force: true });
    throw error;
  }
}

/** 缺失、不可读与 hash 不符都表示该缓存不可复用。 */
async function file_has_sha256(file_path, expected) {
  try {
    return sha256(await fs.readFile(file_path)) === expected;
  } catch {
    return false;
  }
}

/** 所有发布资产统一使用小写十六进制 SHA-256。 */
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** 同时接受 Node 架构名与 electron-builder 的 Arch 枚举值。 */
function resolve_arch_name(arch) {
  if (arch === "x64" || arch === "arm64") return arch;
  if (typeof arch === "number") {
    const value = Arch[arch];
    return typeof value === "string" ? value : null;
  }
  return null;
}

/** 打包前把缺失目录与非普通文件统一报告为资产错误。 */
async function assert_regular_file(file_path, label) {
  let stat;
  try {
    stat = await fs.stat(file_path);
  } catch (cause) {
    throw new Error(`${label} is missing: ${file_path}.`, { cause });
  }
  if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${file_path}.`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await prepare_deno_runtime_for_development();
}
