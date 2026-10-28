import { expect, it } from "vitest";
import {
  compiled_nodes,
  compiled_slots,
  strings_fixture,
  speaker_say,
} from "../../../test/renpy-fixture";
import { PythonSession } from "./python-syntax";
import type { RenpyFormatMetadata } from "./profile";
import { read_scripts, renpy_read_results } from "./read";

/** 直接以编译成员验证姓名与字符串表的条目归属。 */
async function read_items(files: ReadonlyMap<string, Buffer>) {
  using session = await PythonSession.create();
  const metadata: RenpyFormatMetadata = {
    schema: "linguagacha-renpy-1",
    engine_version: "test",
    python_major: 3,
    old_substitutions: true,
    common: [],
  };
  const scripts = await read_scripts(
    [...files.keys()],
    async (name) => files.get(name)!,
    false,
    session,
  );
  return renpy_read_results(scripts, metadata, Buffer.from(JSON.stringify(metadata))).flatMap(
    (result) => {
      if (!result.ok) throw result.error;
      return result.read.items;
    },
  );
}

it("槽位说话者不一致时保留正文唯一写入口和独立姓名", async () => {
  const items = await read_items(
    new Map([
      [
        "game/dialogue.rpyc",
        compiled_slots([[speaker_say("'Alice'", 1)], [speaker_say("'Beth'", 1)]]),
      ],
    ]),
  );
  expect(items.filter((item) => item.src === "Line 1")).toHaveLength(1);
  expect(items.find((item) => item.src === "Line 1")!.name_src).toBeNull();
});

it.each(["Hello", "Alice"])("字符串表拥有 %s 的唯一写入口", async (text) => {
  const items = await read_items(
    new Map([
      ["game/dialogue.rpyc", compiled_nodes([speaker_say("'Alice'", 1, "Hello")])],
      ["game/table.rpyc", strings_fixture([{ language: null, old: text, text: "Base text" }])],
    ]),
  );
  expect(items.some((item) => item.src === text)).toBe(false);
  expect(items.every((item) => item.name_src === null)).toBe(true);
  expect(items.some((item) => item.src === "Base text")).toBe(true);
});
