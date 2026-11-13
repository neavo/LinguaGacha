import { Type, type Static } from "typebox";
import { Compile } from "typebox/compile";
import type JSZip from "jszip";
import { JSON_VALUE_SCHEMA } from "../../../domain/json";

export const GENERIC_ITEMS_MEMBER = "items.json";
export const GENERIC_ITEMS_SCHEMA = Type.Array(
  Type.Object(
    {
      message: Type.String(),
      name: Type.Optional(Type.String()),
    },
    { additionalProperties: JSON_VALUE_SCHEMA },
  ),
);
const VALIDATOR = Compile(GENERIC_ITEMS_SCHEMA);

/** 调用者已经打开归档，记录读取不再解压或解析第二份容器。 */
export async function read_archive_records(
  members: ReadonlyMap<string, JSZip.JSZipObject>,
): Promise<Static<typeof GENERIC_ITEMS_SCHEMA>> {
  const member = members.get(GENERIC_ITEMS_MEMBER);
  if (!member) throw new Error("Missing " + GENERIC_ITEMS_MEMBER);
  const data: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(await member.async("uint8array")),
  );
  if (!VALIDATOR.Check(data)) throw new Error("Invalid message records");
  return data;
}
