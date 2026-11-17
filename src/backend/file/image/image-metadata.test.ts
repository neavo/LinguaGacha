import { expect, it } from "vitest";
import { image_metadata } from "./image-metadata";

it.each(["LE", "BE"] as const)("JPEG EXIF %s 字节序统一到旋转后的原图坐标", (endian) => {
  const tiff = Buffer.alloc(26);
  tiff.write(endian === "LE" ? "II" : "MM");
  const u16 = endian === "LE" ? tiff.writeUInt16LE.bind(tiff) : tiff.writeUInt16BE.bind(tiff);
  const u32 = endian === "LE" ? tiff.writeUInt32LE.bind(tiff) : tiff.writeUInt32BE.bind(tiff);
  u16(42, 2);
  u32(8, 4);
  u16(1, 8);
  u16(274, 10);
  u16(3, 12);
  u32(1, 14);
  u16(6, 18); // EXIF orientation=6，顺时针旋转 90 度。
  const exif = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
  const segment = Buffer.alloc(4);
  segment.writeUInt16BE(0xffe1);
  segment.writeUInt16BE(exif.length + 2, 2);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment,
    exif,
    Buffer.from([0xff, 0xc0, 0, 8, 8, 0, 3, 0, 4, 1, 0xff, 0xd9]),
  ]);
  expect(image_metadata(jpeg)).toMatchObject({ width: 3, height: 4, orientation: 6 });
});
