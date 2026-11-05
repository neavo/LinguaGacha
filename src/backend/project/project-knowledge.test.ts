import { describe, expect, it } from "vitest";
import { AGENT_DOCUMENT_MAX_BYTES } from "../../shared/agent";
import { format_i18n_message } from "../../shared/i18n";
import { project_knowledge_file, record_source_paths } from "./project-knowledge";

describe("工程知识规则", () => {
  it("未保存时按界面语言补模板，指纹绑定空基线而非模板", () => {
    const zh = project_knowledge_file(null, "zh-CN");
    const en = project_knowledge_file(null, "en-US");
    expect(zh.text).not.toBe(en.text);
    expect(zh.fp).toBe(en.fp);
    expect(project_knowledge_file("", "zh-CN").fp).not.toBe(zh.fp);
    expect(project_knowledge_file(zh.text, "zh-CN").fp).not.toBe(zh.fp);
  });

  it("来源路径每行一条落在末节，只追加文中未出现的路径，超限跳过", () => {
    const record = { paths: ["E:/游戏", " E:/游戏 "], locale: "zh-CN" } as const;
    const created = record_source_paths(null, record)!;
    expect(created).toMatch(
      new RegExp(`## ${format_i18n_message("zh-CN", "project_knowledge.paths")}\\n- E:/游戏\\n$`),
    );
    expect(record_source_paths(created, record)).toBeNull();
    expect(record_source_paths("自定义结构", { ...record, paths: ["E:/游戏", "F:/新"] })).toBe(
      "自定义结构\n- E:/游戏\n- F:/新\n",
    );
    expect(record_source_paths(null, { ...record, paths: [] })).toBeNull();
    expect(record_source_paths("x".repeat(AGENT_DOCUMENT_MAX_BYTES), record)).toBeNull();
  });
});
