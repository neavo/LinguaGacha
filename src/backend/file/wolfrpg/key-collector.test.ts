import { expect, it } from "vitest";
import { create_wolfx_candidates, collect_wolfx_keys } from "./key-collector";
import { read_wolf_common } from "./common-events";
import { wolf_common, wolf_command } from "../../../test/wolf-fixture";

it("全部分支保留去重候选，变量编号归一化且负整数按 uint32 保存", () => {
  const candidates = create_wolfx_candidates();
  const document = read_wolf_common(
    wolf_common(0x91, [
      wolf_command(1000, ["Picture", "鍵🔑"], [7]),
      wolf_command(1000, ["Picture", "ignored"], [8]),
      wolf_command(122, ["a"], [3000001]),
      wolf_command(122, ["b"], [1]),
      wolf_command(122, ["a"], [1]),
      wolf_command(121, [], [2000002, -1]),
      wolf_command(121, [], [2, 123]),
    ]),
  );
  for (const event of document.details.events) collect_wolfx_keys(event.commands, candidates);
  expect([...candidates.masters]).toEqual(["", "鍵🔑"]);
  expect([...candidates.strings.get(1)!]).toEqual(["a", "b"]);
  expect([...candidates.integers.get(2)!]).toEqual([0xffffffff, 123]);
});
