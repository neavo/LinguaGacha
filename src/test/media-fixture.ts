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

/** 以独立的逐位 CRC 构造 Ogg 页，避免复用生产校验表形成循环断言。 */
function ogg_fixture(): Buffer {
  const identification = Buffer.alloc(19);
  identification.write("OpusHead");
  identification[8] = 1;
  identification[9] = 1;
  identification.writeUInt32LE(48000, 12);
  const comments = Buffer.alloc(16);
  comments.write("OpusTags");
  const packets = [identification, comments, Buffer.from([0xf8, 0xff, 0xfe])]; // 单声道 Opus 静音帧。
  return Buffer.concat(
    packets.map((packet, index) => {
      const page = Buffer.alloc(28 + packet.length);
      page.write("OggS");
      page[5] = index === 0 ? 2 : index === 2 ? 4 : 0;
      page.writeBigUInt64LE(index === 2 ? 960n : 0n, 6);
      page.writeUInt32LE(1, 14);
      page.writeUInt32LE(index, 18);
      page[26] = 1;
      page[27] = packet.length;
      packet.copy(page, 28);
      let checksum = 0;
      for (const byte of page) {
        checksum ^= byte << 24;
        for (let bit = 0; bit < 8; bit++)
          checksum = (checksum << 1) ^ (checksum & 0x80000000 ? 0x04c11db7 : 0);
      }
      page.writeUInt32LE(checksum >>> 0, 22);
      return page;
    }),
  );
}

/** M4A 用例只验证 `ftyp` 盒布局和字节复制，此夹具不承担音频解码验收。 */
function m4a_fixture(): Buffer {
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(ftyp.length);
  ftyp.write("ftyp", 4);
  ftyp.write("M4A ", 8);
  ftyp.write("M4A isom", 16);
  const free = Buffer.alloc(8);
  free.writeUInt32BE(free.length);
  free.write("free", 4);
  return Buffer.concat([ftyp, free]);
}

/** 每次返回独立字节，损坏输入测试可以直接修改自己的夹具。 */
export function media_fixture(extension: "png" | "ogg" | "m4a"): Buffer {
  return extension === "png" ? png_fixture() : extension === "ogg" ? ogg_fixture() : m4a_fixture();
}

export const MEDIA_KEY = "00112233445566778899aabbccddeeff";
/** 已知明文生成原生媒体，仅用于断言生产解密结果。 */
export function encrypted_media(plain: Buffer): Buffer {
  const bytes = Buffer.from(plain),
    key = Buffer.from(MEDIA_KEY, "hex");
  for (let i = 0; i < 16; i++) bytes[i] = bytes[i]! ^ key[i]!;
  return Buffer.concat([Buffer.from("5250474d560000000003010000000000", "hex"), bytes]);
}
