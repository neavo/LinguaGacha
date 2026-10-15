import { inflateSync } from "node:zlib";
import type { MarshalNode } from "./marshal";
import { bytes, read_text } from "./value";

const MAX_SCRIPT_BYTES = 32 * 1024 * 1024; // 限制单段脚本的解压内存。

/** 压缩载荷先解压，再按源码编码声明读取，导入、导出和原稿明文共用此边界。 */
export function read_rgss_script(node: MarshalNode): { source: string; encoding: string } {
  const data = inflateSync(bytes(node), { maxOutputLength: MAX_SCRIPT_BYTES });
  // 编码名采用 ASCII 语法，先按单字节读取头部，再用声明的编码解码正文。
  const header = data.subarray(0, 256).toString("latin1").split(/\r?\n/u).slice(0, 2).join("\n");
  const encoding =
    /^[ \t]*#[^\n]*(?:coding|encoding)[ \t]*[:=][ \t]*([\w-]+)/imu.exec(header)?.[1] ?? "utf8";
  return { source: read_text(data, encoding), encoding };
}
