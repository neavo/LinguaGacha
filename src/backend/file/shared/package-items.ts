import type JSZip from "jszip";

export const PACKAGE_ITEMS_MEMBER = "items.json"; // 三类数据包共用的条目入口。

/** 调用者已经打开归档；这里只解析条目，领域读取器负责校验。 */
export async function read_package_items(
  members: ReadonlyMap<string, JSZip.JSZipObject>,
): Promise<unknown> {
  const member = members.get(PACKAGE_ITEMS_MEMBER);
  if (!member) throw new Error("Missing " + PACKAGE_ITEMS_MEMBER);
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(await member.async("uint8array")),
  );
}
