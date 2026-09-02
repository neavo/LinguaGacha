import { describe, expect, it } from "vitest";

import {
  collect_text_resource_references,
  project_text_resource_references,
  remove_text_resource_references,
  restore_text_resource_references,
  transform_projected_text_resource_references,
} from "./text-resource-reference";

describe("text-resource-reference", () => {
  it("按优先级识别 Base64 data URI、URI 和无 scheme 资源路径", () => {
    const base64 = "data:image/png;base64,AAABBB==";
    const text = `${base64} https://example.com/a.png?size=2#cover bg\\scene.WEBP 资源/背景图.png cover.avif manual.DOCX archive.tar.gz`;

    expect(collect_text_resource_references(text).map(({ value }) => value)).toEqual([
      base64,
      "https://example.com/a.png?size=2#cover",
      "bg\\scene.WEBP",
      "资源/背景图.png",
      "cover.avif",
      "manual.DOCX",
      "archive.tar.gz",
    ]);
  });

  it("保留 URI 内配对括号并移除外围标点", () => {
    const text = "请看（https://example.com/a_(1).png），然后继续。";

    expect(collect_text_resource_references(text).map((reference) => reference.value)).toEqual([
      "https://example.com/a_(1).png",
    ]);
    expect(remove_text_resource_references(text)).toBe("请看（），然后继续。");
  });

  it("不把裸 Base64、裸扩展名和普通 scheme 形文字当作引用", () => {
    expect(
      collect_text_resource_references(
        "AAAAABBBBBCCCCCDDDD 支持 .json 文件 chapter:one demo.mp3backup demo.mp3后缀",
      ),
    ).toEqual([]);
  });

  it("以扁平序号投影多个字段并精确恢复", () => {
    const first = project_text_resource_references("打开 https://example.com 和 image.png", 0);
    const second = project_text_resource_references(
      "data:image/png;base64,AAAA",
      first.next_ordinal,
    );

    expect(first.text).toBe("打开 lg-uri/0 和 lg-uri/1");
    expect(second.text).toBe("lg-uri/2");
    expect(
      restore_text_resource_references(`${first.text}\n${second.text}`, [
        ...first.mappings,
        ...second.mappings,
      ]),
    ).toBe("打开 https://example.com 和 image.png\ndata:image/png;base64,AAAA");
  });

  it("生成序号会跳过源文已有的同形 token", () => {
    const projection = project_text_resource_references("literal lg-uri/0 image.png");

    expect(projection.text).toBe("literal lg-uri/0 lg-uri/1");
    expect(restore_text_resource_references(projection.text, projection.mappings)).toBe(
      "literal lg-uri/0 image.png",
    );
  });

  it("恢复时不会把短序号匹配到长序号前缀", () => {
    expect(
      restore_text_resource_references("lg-uri/10 lg-uri/1", [
        { token: "lg-uri/1", value: "one.png" },
      ]),
    ).toBe("lg-uri/10 one.png");
  });

  it("恢复值中的 token 形文本不会被再次替换", () => {
    expect(
      restore_text_resource_references("lg-uri/0 lg-uri/1", [
        { token: "lg-uri/0", value: "literal-lg-uri/1.txt" },
        { token: "lg-uri/1", value: "actual.png" },
      ]),
    ).toBe("literal-lg-uri/1.txt actual.png");
  });

  it("本地转换只作用于临时引用之间的文本", () => {
    expect(
      transform_projected_text_resource_references(
        "before lg-uri/0 after",
        [{ token: "lg-uri/0", value: "https://example.com" }],
        (value) => value.toUpperCase(),
      ),
    ).toBe("BEFORE lg-uri/0 AFTER");
  });
});
