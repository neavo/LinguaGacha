import { crc32, deflateSync } from "node:zlib";

/** 生成完整的一像素 PNG，块长度、校验和与压缩像素均由测试自有数据构造。 */
export function png_fixture(): Buffer {
  function chunk(type: string, data: Buffer): Buffer {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // 八位 RGB，像素行使用无过滤编码。
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const MEDIA_KEY = "00112233445566778899aabbccddeeff";
/** 已知明文生成原生媒体，仅用于断言生产解密结果。 */
export function encrypted_media(plain: Buffer): Buffer {
  const bytes = Buffer.from(plain),
    key = Buffer.from(MEDIA_KEY, "hex");
  for (let i = 0; i < Math.min(key.length, bytes.length); i++) bytes[i] = bytes[i]! ^ key[i]!;
  return Buffer.concat([Buffer.from("5250474d560000000003010000000000", "hex"), bytes]);
}
