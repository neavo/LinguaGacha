const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_IHDR_LENGTH = 13;
const PNG_CHUNK_HEADER = 8; // 四字节长度与四字节类型。
const PNG_CHUNK_OVERHEAD = PNG_CHUNK_HEADER + 4; // 块数据之后是 CRC。
const PNG_HEADER_END = PNG_SIGNATURE.length + PNG_CHUNK_OVERHEAD + PNG_IHDR_LENGTH;

/** 读取 PNG 头部。签名不匹配时交由调用方判断其它格式。 */
export function read_png_header(bytes: Buffer) {
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return undefined;
  if (
    bytes.length < PNG_HEADER_END ||
    bytes.readUInt32BE(PNG_SIGNATURE.length) !== PNG_IHDR_LENGTH ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    throw new Error("Invalid PNG header");
  const color_type = bytes[25]!;
  if (bytes[24] !== 8 || ![0, 2, 3, 4, 6].includes(color_type))
    throw new Error("Unsupported PNG depth");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), color_type };
}

/** 原图与区域都要求静态 PNG。按块借用原始数据，调用方决定读到哪里。 */
export function* read_png_chunks(bytes: Buffer) {
  for (let offset = PNG_HEADER_END; offset + PNG_CHUNK_OVERHEAD <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const start = offset + PNG_CHUNK_HEADER;
    const type = bytes.toString("ascii", offset + 4, start);
    const end = start + length;
    const next = end + 4;
    if (next > bytes.length) throw new Error("Invalid PNG chunk");
    if (type === "acTL" || type === "tRNS")
      throw new Error("Animated or transparent PNG is unsupported");
    yield { type, data: bytes.subarray(start, end) };
    offset = next;
  }
}

/** 读取静态 PNG 或 JPEG 原图的尺寸与方向，JPEG 尺寸统一到旋转后的坐标。 */
export function image_metadata(content: Uint8Array): {
  width: number;
  height: number;
  orientation: number;
  extension: string;
} {
  const bytes = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  const png = read_png_header(bytes);
  if (png) {
    // 头部无法判定动画或 tRNS，须读取后续块。
    for (const { type } of read_png_chunks(bytes)) if (type === "IEND") break;
    return { width: png.width, height: png.height, orientation: 1, extension: ".png" };
  }
  if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error("Expected PNG or JPEG");
  let width = 0,
    height = 0,
    orientation = 1;
  for (let offset = 2; offset + 4 < bytes.length;) {
    if (bytes[offset++] !== 255) throw new Error("Invalid JPEG marker");
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++]!;
    if (marker === 218 || marker === 217) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error("Invalid JPEG segment");
    if ([192, 193, 194].includes(marker)) {
      height = bytes.readUInt16BE(offset + 3);
      width = bytes.readUInt16BE(offset + 5);
    }
    if (marker === 225 && bytes.toString("ascii", offset + 2, offset + 8) === "Exif\0\0") {
      const tiff = bytes.subarray(offset + 8, offset + length);
      const little = tiff.toString("ascii", 0, 2) === "II";
      const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
      const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
      const directory = u32(4),
        count = u16(directory);
      for (let i = 0; i < count; i++) {
        const at = directory + 2 + i * 12;
        if (u16(at) === 274) orientation = u16(at + 8);
      }
    }
    offset += length;
  }
  if (!width || !height || orientation < 1 || orientation > 8)
    throw new Error("Invalid JPEG dimensions or orientation");
  return {
    width: orientation >= 5 ? height : width,
    height: orientation >= 5 ? width : height,
    orientation,
    extension: ".jpg",
  };
}
