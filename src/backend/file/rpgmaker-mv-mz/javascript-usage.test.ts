import { expect, it } from "vitest";
import { read_javascript_strings } from "./javascript";

/** 使用真实解析器建立祖先链，验证最终字符串用途。 */
function usages(source: string) {
  const result = read_javascript_strings(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.strings.map(({ usage }) => usage);
}

it.each(["Save", "保存", "セーブ", "Enregistrer"])("按结构判断用途，与语言无关：%s", (text) => {
  const literal = JSON.stringify(text);
  expect(
    usages(
      `const x = {${literal}: ${literal}, [${literal}]: ${literal}, ${literal}() { return ${literal}; }};`,
    ),
  ).toEqual(["metadata", "text", "metadata", "text", "metadata", "text"]);
  expect(
    usages(
      `class X { ${literal} = ${literal}; [${literal}]() { return ${literal}; } }; x[${literal}]; show(${literal});`,
    ),
  ).toEqual(["metadata", "text", "metadata", "text", "metadata", "text"]);
  expect(
    usages(
      `PluginManager.parameters(${literal}); PluginManager.registerCommand(${literal}, ${literal}, () => show(${literal})); PluginManagerEx.registerCommand(document.currentScript, ${literal}, () => show(${literal}));`,
    ),
  ).toEqual(["metadata", "metadata", "metadata", "text", "metadata", "text"]);
  expect(
    usages(
      `const x = [${literal}]; if (x === ${literal}) show(${literal}); switch (x) { case ${literal}: break; }`,
    ),
  ).toEqual(["text", "text", "text", "text"]);
});

it.each(["var $plugins =", "$plugins ="])(
  "标准插件记录排除身份和介绍，参数值与普通介绍保留：%s",
  (prefix) => {
    expect(
      usages(
        `${prefix} [{name:"插件", "description":"插件介绍", status:true, parameters:{参数:"显示文字", description:"帮助", 配置:"{\\"Text\\":\\"正文\\"}"}}]; const item = {description:"物品说明"};`,
      ),
    ).toEqual(["metadata", "metadata", "metadata", "text", "text", "text", "text"]);
  },
);

it("静态模板可判定标识，动态表达式与同名方法保持候选", () => {
  expect(usages('PluginManager.registerCommand(...args, "保留");')).toEqual(["text"]);
  expect(
    usages(
      'x[`静态键`]; x[`前${name}后`]; PluginManager[`parameters`](`插件`); PluginManager[parameters]("保留"); other.parameters("保留"); PluginManager.parameters(show("保留"));',
    ),
  ).toEqual(["metadata", "text", "text", "metadata", "metadata", "text", "text", "text"]);
  expect(
    usages('const $plugins = [{[description]: "动态字段", nested: {description: "嵌套说明"}}];'),
  ).toEqual(["text", "text"]);
});
