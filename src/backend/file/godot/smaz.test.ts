import { expect, it } from "vitest";
import { smaz_decode } from "./smaz";

it("Smaz 码表、字面量与错误长度", () => {
  expect(smaz_decode(Buffer.from([1, 254, 33]), 4).toString()).toBe("the!");
  expect(smaz_decode(Buffer.from([255, 2, 97, 98, 99]), 3).toString()).toBe("abc");
  expect(() => smaz_decode(Buffer.from([255, 3, 97]), 4)).toThrow();
});
