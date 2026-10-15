import { expect, it } from "vitest";
import { read_json_record, type JsonValue } from "../../../domain/json";
import { RPGMakerJsonCodec } from "./json-codec";

it("普通数值与容器保留原类型，修改和新建字段按普通规则编码", () => {
  const codec = new RPGMakerJsonCodec();
  const root = read_json_record(
    codec.parse(
      '{"same":1.2300,"changed":9.9900,"negative":-0,"object":{"n":2.5000},"values":[-0,1e2]}',
    ),
  );
  expect(root["same"]).toBe(1.23);
  expect(Object.is(root["negative"], -0)).toBe(true);
  root["changed"] = 8;
  root["negative"] = 0;
  root["object"] = { n: 2.5 };
  (root["values"] as JsonValue[])[0] = 0;
  root["added"] = 7.25;
  expect(codec.stringify(root)).toBe(
    '{"same":1.2300,"changed":8,"negative":0,"object":{"n":2.5},"values":[0,1e2],"added":7.25}',
  );
});
