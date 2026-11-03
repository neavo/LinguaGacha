import { format_i18n_message } from "../../shared/i18n";
import { describe, expect, it, vi } from "vitest";
import { AGENT_DOCUMENT_MAX_BYTES } from "../../shared/agent";
import type { KnowledgeIntent } from "../../shared/project-knowledge";
import {
  append_source_record,
  normalize_knowledge_path,
  project_knowledge_entry,
  project_knowledge_fingerprint,
  read_knowledge_description,
  resolve_knowledge_changes,
} from "./project-knowledge";

describe("工程知识规则", () => {
  it("规范化相对 Markdown 路径并在落盘前拒绝非法名称", () => {
    expect(normalize_knowledge_path("Notes\\World.MD")).toBe("Notes/World.MD");
    for (const path of ["", "C:/a.md", "/a.md", "../a.md", "a/./b.md", "con/a.md", "a.txt"])
      expect(() => normalize_knowledge_path(path), path).toThrow();
  });

  it("正文允许无头部，描述按单行消费，错误 YAML 与超限正文拒绝写入", () => {
    expect(project_knowledge_entry({ path: "note.md", text: "普通笔记" })).not.toHaveProperty(
      "description",
    );
    expect(read_knowledge_description("---\ndescription: |\n  first\n  second\n---\nbody")).toBe(
      "first second",
    );
    for (const text of [
      "---\ndescription: 1\n---\n",
      "---\ndescription: null\n---\n",
      "汉".repeat(Math.floor(AGENT_DOCUMENT_MAX_BYTES / 3) + 1),
    ])
      expect(() => read_knowledge_description(text), text.slice(0, 80)).toThrow();
    expect(read_knowledge_description("a".repeat(AGENT_DOCUMENT_MAX_BYTES))).toBeUndefined();
  });

  it("指纹绑定路径和正文，同批拒绝重复、丢失、旧版本与覆盖式新建", () => {
    const document = { path: "notes.md", text: "old" };
    const fp = project_knowledge_fingerprint(document.path, document.text);
    expect(project_knowledge_fingerprint("other.md", document.text)).not.toBe(fp);
    const cases: [KnowledgeIntent[], string][] = [
      [[{ op: "create", line: 1, path: "NOTES.md", text: "new" }], "invalid_change"],
      [[{ op: "update", line: 1, path: document.path, fp: "stale", text: "new" }], "fp_mismatch"],
      [[{ op: "delete", line: 1, path: "missing.md", fp }], "target_missing"],
      [
        [
          { op: "update", line: 1, path: document.path, fp, text: "new" },
          { op: "delete", line: 2, path: "NOTES.md", fp },
        ],
        "merge_conflict",
      ],
    ];
    for (const [intents, reason] of cases) {
      const result = resolve_knowledge_changes([document], intents);
      expect(result.writes).toEqual([]);
      expect(result.rejected).toHaveLength(intents.length);
      expect(result.rejected.every((rejection) => rejection.reason === reason)).toBe(true);
    }
    expect(
      resolve_knowledge_changes(
        [document],
        [{ op: "update", line: 1, path: "NOTES.md", fp, text: "old" }],
      ).writes,
    ).toEqual([]);
  });

  it("删除释放最终路径，文件和目录冲突不影响其他合法文档", () => {
    const document = { path: "old.md", text: "keep" };
    const create = { op: "create", line: 1, path: "old.md/new.md", text: "keep" } as const;
    expect(resolve_knowledge_changes([document], [create]).rejected).toMatchObject([
      { reason: "invalid_change" },
    ]);
    const result = resolve_knowledge_changes(
      [document],
      [
        create,
        {
          op: "delete",
          line: 1,
          path: document.path,
          fp: project_knowledge_fingerprint(document.path, document.text),
        },
      ],
    );
    expect(result.rejected).toEqual([]);
    expect(result.writes).toEqual([
      { path: create.path, text: "keep" },
      { path: document.path, text: null },
    ]);
    expect(
      resolve_knowledge_changes(
        [{ path: create.path, text: "keep" }],
        [
          { op: "create", line: 1, path: "OLD.md", text: "bad" },
          { op: "create", line: 2, path: "valid.md", text: "valid" },
        ],
      ).writes,
    ).toEqual([{ path: "valid.md", text: "valid" }]);
  });

  it("来源记录使用本地日期和当前语言，只追加原文，超限跳过", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 3, 12));
    try {
      const record = {
        action: "create",
        paths: ["E:/游戏", "E:/path`name"],
        locale: "zh-CN",
      } as const;
      const text = append_source_record(null, record)!;
      expect(text).toContain(
        `2026-11-03 · ${format_i18n_message(record.locale, "project_knowledge.create")}`,
      );
      expect(text).toContain("` E:/游戏 `、`` E:/path`name ``");
      expect(read_knowledge_description(text)).toBeTypeOf("string");
      const edited = "自定义结构\n<!-- 请保留 -->";
      expect(
        append_source_record(edited, { ...record, action: "import", locale: "en-US" }),
      ).toContain(
        `${edited}\n\n- 2026-11-03 · ${format_i18n_message("en-US", "project_knowledge.import")}:`,
      );
      expect(append_source_record("x".repeat(AGENT_DOCUMENT_MAX_BYTES), record)).toBeNull();
      expect(append_source_record(null, { ...record, paths: [] })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
