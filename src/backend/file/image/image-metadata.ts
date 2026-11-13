/** 静态不透明 PNG/JPEG 的头部契约，像素解码仍由固定 helper 执行。 */
export function image_metadata(content: Uint8Array): {
  width: number;
  height: number;
  orientation: number;
  extension: string;
} {
  const bytes = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    if (bytes.length < 33 || bytes.toString("ascii", 12, 16) !== "IHDR")
      throw new Error("Invalid PNG header");
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset),
        type = bytes.toString("ascii", offset + 4, offset + 8);
      if (offset + length + 12 > bytes.length || type === "acTL" || type === "tRNS")
        throw new Error("Animated or transparent PNG is unsupported");
      offset += length + 12;
    }
    if (bytes[24] !== 8 || ![0, 2, 3, 4, 6].includes(bytes[25]!))
      throw new Error("Unsupported PNG depth");
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      orientation: 1,
      extension: ".png",
    };
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
