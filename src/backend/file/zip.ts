import JSZip from "jszip";

export type ZipContents = Map<string, string | Uint8Array>;

/** EPUB 的 mimetype 首先写入且不压缩；所有资源沿用原路径与 STORE 写出方式。 */
export async function write_zip(contents: ZipContents): Promise<Buffer> {
  const zip = new JSZip();
  if (contents.has("mimetype"))
    zip.file("mimetype", contents.get("mimetype")!, { compression: "STORE" });
  for (const [name, value] of contents) if (name !== "mimetype") zip.file(name, value);
  return zip.generateAsync({ compression: "STORE", type: "nodebuffer" });
}
