import { wolf_vectors, wolf_vector } from "../../../test/wolf-vectors";
import { expect, it } from "vitest";
import { wolf_database } from "../../../test/wolf-fixture";
import { assert_wolf_roundtrip } from "../../../test/wolf-roundtrip";
import { read_wolf_database } from "./database";
import { replace_wolf_slots, normalize_wolf_descriptions, encode_wolf_string } from "./binary";

it.each([0xc2, 0xc3, 0xc4])("数据库布局 %i 保留未修改字节并支持变长写回", (version) => {
  const { data, project } = wolf_database(version);
  assert_wolf_roundtrip(data, (bytes) => read_wolf_database(project, bytes).data);
});

it("数据库配对、资源别名和描述文件定位独立于显示名称", () => {
  const pair = wolf_database(0xc4, true, true),
    db = read_wolf_database(pair.project, pair.data);
  expect(db.data.slots[0]).toMatchObject({
    usage: "metadata",
    location: { kind: "database_string", type: 0, record: 0, string: 0 },
  });
  const renamed = replace_wolf_slots(db.project, new Map([[db.project.slots[0]!, "另一个类型"]]));
  expect(read_wolf_database(renamed, pair.data).types[0]!.name).toBe("另一个类型");
  expect(() => read_wolf_database(pair.project.subarray(4), pair.data)).toThrow();
});

it("数据库只清理类型说明，保留配对和其它字段字节", () => {
  const vectors = wolf_vectors.descriptions,
    data = wolf_vector(vectors.data),
    db = read_wolf_database(wolf_vector(vectors.project), data),
    doc = db.project,
    field = doc.descriptions![0]!;
  expect(field.text).toBe("保護\u0001\0\u001f説明\n");
  const result = normalize_wolf_descriptions(doc);
  expect(
    Buffer.from(result).equals(
      Buffer.concat([
        doc.bytes.subarray(0, field.start),
        encode_wolf_string("保護説明\n", doc.utf8),
        doc.bytes.subarray(field.end),
      ]),
    ),
  ).toBe(true);
  expect(read_wolf_database(result, data).types).toEqual(db.types);
});
