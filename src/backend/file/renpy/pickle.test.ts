import { splice } from "../shared/splice";
import { expect, it } from "vitest";
import {
  read_pickle,
  read_pickle_async,
  resolve_node,
  node_string,
  edge_edit,
  pickle_string,
} from "./pickle";
import { setImmediate } from "node:timers";

it("共享 memo 的字典键与消费值分别修改，不改变其他引用", () => {
  const raw = Buffer.from(
    "80027d710028580400000073616d657101680158050000006f7468657271026801752e",
    "hex",
  );
  const entries = resolve_node(read_pickle(raw).root).children;
  const edits = [
    edge_edit(entries[0]!, pickle_string("key")),
    edge_edit(entries[1]!, pickle_string("value")),
    edge_edit(entries[2]!, pickle_string("other key")),
  ];
  const output = splice(raw, edits);
  expect(resolve_node(read_pickle(output).root).children.map(node_string)).toEqual([
    "key",
    "value",
    "other key",
    "same",
  ]);
  expect(output.subarray(0, edits[0]!.start)).toEqual(raw.subarray(0, edits[0]!.start));
  for (const index of [0, 1, 3]) {
    const result = read_pickle(splice(raw, [edge_edit(entries[index]!, pickle_string("译文🙂"))]));
    expect(resolve_node(result.root).children.map(node_string)).toEqual(
      ["same", "same", "other", "same"].map((text, at) => (at === index ? "译文🙂" : text)),
    );
  }
});
it("不执行 reducer，拒绝未知指令、截断和未定义引用", () => {
  const graph = read_pickle(Buffer.from("cos\nsystem\n)R.", "ascii"));
  expect(graph.root.kind).toBe("object");
  for (const bytes of [
    Buffer.from([0x80, 2, 0xff]),
    Buffer.from([0x68, 1, 0x2e]),
    Buffer.from([0x58, 0xff]),
  ])
    expect(() => read_pickle(bytes)).toThrow();
});
it("大索引解析让出事件循环并响应取消", async () => {
  const bytes = Buffer.concat([
    Buffer.from([0x80, 2, 0x5d, 0x28]),
    Buffer.alloc(100_000, 0x4e),
    Buffer.from([0x65, 0x2e]),
  ]);
  const controller = new AbortController();
  setImmediate(() => controller.abort());
  await expect(read_pickle_async(bytes, controller.signal)).rejects.toThrow();
  expect(read_pickle(bytes).root.children).toHaveLength(100_000);
});
