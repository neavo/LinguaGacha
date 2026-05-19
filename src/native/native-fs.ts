import fs from "node:fs";
import path from "node:path";

import { NativePathPolicy, default_native_path_policy } from "./native-path";

/**
 * 同步删除选项只暴露项目实际使用的安全子集。
 */
export interface NativeRemoveOptions {
  readonly recursive?: boolean;
  readonly force?: boolean;
}

/**
 * 把第三方库返回的二进制对象收窄成 Node 写文件可稳定消费的 Uint8Array。
 */
export function normalize_native_file_bytes(content: unknown): Uint8Array {
  if (content instanceof Uint8Array) {
    return content;
  }
  if (content instanceof ArrayBuffer) {
    return new Uint8Array(content);
  }
  throw new TypeError("文件二进制内容必须是 Uint8Array 或 ArrayBuffer。");
}

/**
 * Core / worker 唯一文件系统门面，所有真实磁盘 IO 都先经过平台路径策略。
 */
export class NativeFs {
  /**
   * path_policy 是 Windows 长路径和跨平台路径身份的唯一策略入口。
   */
  public constructor(private readonly path_policy: NativePathPolicy = default_native_path_policy) {}

  /**
   * 将业务路径转换为可传给 Node / 原生模块的文件系统路径。
   */
  public to_native_path(file_path: string): string {
    return this.path_policy.to_native_path(file_path);
  }

  /**
   * 生成用于路径比较的稳定身份。
   */
  public to_identity_path(file_path: string): string {
    return this.path_policy.to_identity_path(file_path);
  }

  /**
   * 判断路径是否存在；缺失和不可访问都按 false 处理，匹配 Node existsSync 语义。
   */
  public exists(target_path: string): boolean {
    return fs.existsSync(this.to_native_path(target_path));
  }

  /**
   * 读取文件或目录状态，调用方根据业务语义判断文件类型。
   */
  public stat(target_path: string): fs.Stats {
    return fs.statSync(this.to_native_path(target_path));
  }

  /**
   * 读取目录项名称，供只关心文件名的列表场景使用。
   */
  public read_dir_names(directory: string): string[] {
    return fs.readdirSync(this.to_native_path(directory));
  }

  /**
   * 读取目录项和类型信息，供递归扫描避免额外 stat。
   */
  public read_dirents(directory: string): fs.Dirent[] {
    return fs.readdirSync(this.to_native_path(directory), { withFileTypes: true });
  }

  /**
   * 判断目录创建是否可以跳过；空目录和文件系统根都不是可创建的业务目录。
   */
  private should_skip_make_dir(directory: string): boolean {
    return directory === "" || this.path_policy.is_filesystem_root(directory);
  }

  /**
   * 异步递归创建目录，和同步入口共享根目录 no-op 语义。
   */
  private async make_dir_async(directory: string): Promise<void> {
    if (this.should_skip_make_dir(directory)) {
      return;
    }
    await fs.promises.mkdir(this.to_native_path(directory), { recursive: true });
  }

  /**
   * 递归创建目录；空目录和文件系统根目录视为已存在，无需额外动作。
   */
  public make_dir(directory: string): void {
    if (this.should_skip_make_dir(directory)) {
      return;
    }
    fs.mkdirSync(this.to_native_path(directory), { recursive: true });
  }

  /**
   * 确保目标文件的父目录存在。
   */
  public ensure_parent_dir(file_path: string): void {
    this.make_dir(path.dirname(file_path));
  }

  /**
   * 同步读取二进制文件。
   */
  public read_file(file_path: string): Buffer {
    return fs.readFileSync(this.to_native_path(file_path));
  }

  /**
   * 同步读取文本文件。
   */
  public read_text_file(file_path: string, encoding: BufferEncoding = "utf-8"): string {
    return fs.readFileSync(this.to_native_path(file_path), encoding);
  }

  /**
   * 异步写入二进制或文本文件，并在写入前创建父目录。
   */
  public async write_file(file_path: string, data: string | Uint8Array): Promise<void> {
    await this.make_dir_async(path.dirname(file_path));
    await fs.promises.writeFile(this.to_native_path(file_path), data);
  }

  /**
   * 同步写入二进制或文本文件，并在写入前创建父目录。
   */
  public write_file_sync(file_path: string, data: string | Uint8Array): void {
    this.ensure_parent_dir(file_path);
    fs.writeFileSync(this.to_native_path(file_path), data);
  }

  /**
   * 同步追加日志文本；日志目录缺失时由门面补齐。
   */
  public append_text_file(file_path: string, text: string): void {
    this.ensure_parent_dir(file_path);
    fs.appendFileSync(this.to_native_path(file_path), text, "utf-8");
  }

  /**
   * 同步重命名路径，调用方负责校验业务边界。
   */
  public rename(source_path: string, destination_path: string): void {
    this.ensure_parent_dir(destination_path);
    fs.renameSync(this.to_native_path(source_path), this.to_native_path(destination_path));
  }

  /**
   * 同步复制单个文件，调用方负责决定覆盖语义。
   */
  public copy_file(source_path: string, destination_path: string): void {
    this.ensure_parent_dir(destination_path);
    fs.copyFileSync(this.to_native_path(source_path), this.to_native_path(destination_path));
  }

  /**
   * 同步复制文件或目录，保持迁移场景的目录递归语义集中。
   */
  public copy_entry(source_path: string, destination_path: string): void {
    this.ensure_parent_dir(destination_path);
    const native_source = this.to_native_path(source_path);
    const native_destination = this.to_native_path(destination_path);
    if (fs.statSync(native_source).isDirectory()) {
      fs.cpSync(native_source, native_destination, { recursive: true });
      return;
    }
    fs.copyFileSync(native_source, native_destination);
  }

  /**
   * 同步删除文件或目录，保留调用方传入的 force / recursive 语义。
   */
  public remove(target_path: string, options: NativeRemoveOptions = {}): void {
    fs.rmSync(this.to_native_path(target_path), options);
  }

  /**
   * 同步删除单个文件，语义等同 unlinkSync。
   */
  public unlink(target_path: string): void {
    fs.unlinkSync(this.to_native_path(target_path));
  }

  /**
   * 删除空目录，迁移清理旧目录时保留 rmdir 的严格语义。
   */
  public remove_empty_dir(directory: string): void {
    fs.rmdirSync(this.to_native_path(directory));
  }
}

/**
 * 默认 NativeFs 实例，生产代码只共享这个门面而不直接触碰 node:fs。
 */
export const default_native_fs = new NativeFs();
