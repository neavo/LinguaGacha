import { expect, it } from "vitest";
import "../../../test/renpy-fixture";
import { PythonSession } from "./python-syntax";
import { string_usage } from "./usage";

it.each([
  ['Text(font="gui.ttf", text="Caption")', { "gui.ttf": "code", Caption: "display" }],
  ['Text("Hello", font="other.ttf")', { Hello: "display", "other.ttf": "code" }],
  ['unknown(text="identifier")', { identifier: "code" }],
  ['renpy.say(who="Eileen", what="Dialogue")', { Eileen: "code", Dialogue: "say" }],
  ['Text(*args, "Uncertain")', { Uncertain: "code" }],
  ['Text(unknown(text="Nested"))', { Nested: "code" }],
  ['_p("Long  text")', { "Long  text": "paragraph" }],
  ['log(what="Hi %s" % name)', { "Hi %s": "display" }],
])("显示调用按实际参数绑定分类：%s", async (source, expected) => {
  using session = await PythonSession.create();
  const facts = await session.analyze({ source, mode: "exec" });
  expect(
    Object.fromEntries(facts.constants.map((token) => [token.value, string_usage(token, false)])),
  ).toEqual(expected);
});

it("界面整体值中的拼接片段归为 code", async () => {
  using session = await PythonSession.create();
  const facts = await session.analyze({ source: 'prefix + "caption"', mode: "eval" });
  expect(string_usage(facts.constants[0]!, true)).toBe("code");
});
