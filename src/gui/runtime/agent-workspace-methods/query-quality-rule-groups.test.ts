import { describe, expect, it } from "vitest";

import { read_json_record, type JsonRecord } from "../../../domain/json";
import {
  execute_workspace_method,
  glossary_entry,
  relation_candidate,
} from "../../../test/agent-workspace-methods/test-support";

describe("workspace.groupQualityRuleEntries 发布方法", () => {
  it("为既有术语生成互斥结构组并返回关系原因", async () => {
    const result = read_json_record(
      await execute_workspace_method(
        "groupQualityRuleEntries",
        { kind: "glossary", target_entry_ids: ["erin", "dotour-house"] },
        {
          "glossary/entries.jsonl": [
            glossary_entry("erin", "艾琳"),
            glossary_entry("saint", "圣女艾琳"),
            glossary_entry("duplicate", "圣女艾琳"),
            glossary_entry("dotour-house", "ドトール家"),
            glossary_entry("dotour-territory", "ドトール領"),
          ],
        },
      ),
    );

    expect(result).toMatchObject({
      total_entry_count: 5,
      total_target_entry_count: 2,
      total_component_count: 3,
      total_group_count: 2,
      missing_target_entry_ids: [],
    });
    expect(result["groups"]).toEqual([
      {
        group_id: "group-0001",
        component_ids: ["component-0001"],
        entry_ids: ["erin", "saint", "duplicate"],
        target_entry_ids: ["erin"],
        relations: expect.arrayContaining([
          { reason: "equivalent", entry_ids: ["saint", "duplicate"] },
          { reason: "contains", entry_ids: ["saint", "erin"] },
        ]),
      },
      {
        group_id: "group-0002",
        component_ids: ["component-0002", "component-0003"],
        entry_ids: ["dotour-house", "dotour-territory"],
        target_entry_ids: ["dotour-house"],
        relations: [
          {
            reason: "shared_root",
            root: "ドトール",
            entry_ids: ["dotour-house", "dotour-territory"],
          },
        ],
      },
    ]);
    expect(result["cross_group_relations"]).toEqual([]);
  });

  it("对候选使用同一算法且弱关系不传递", async () => {
    const result = read_json_record(
      await execute_workspace_method(
        "groupQualityRuleEntries",
        {
          kind: "glossary",
          entries: [
            relation_candidate("left", "甲乙一"),
            relation_candidate("middle", "甲乙丙丁"),
            relation_candidate("right", "丙丁二"),
          ],
        },
        {},
      ),
    );

    expect(result["groups"]).toEqual([
      {
        group_id: "group-0001",
        component_ids: ["component-0001", "component-0002"],
        entry_ids: ["left", "middle"],
        target_entry_ids: ["left", "middle"],
        relations: [{ reason: "shared_root", root: "甲乙", entry_ids: ["left", "middle"] }],
      },
      {
        group_id: "group-0002",
        component_ids: ["component-0003"],
        entry_ids: ["right"],
        target_entry_ids: ["right"],
        relations: [],
      },
    ]);
    expect(result["cross_group_relations"]).toEqual([
      {
        reason: "shared_root",
        root: "丙丁",
        entry_ids: ["middle", "right"],
        group_ids: ["group-0001", "group-0002"],
      },
    ]);
  });

  it("以领域声明的 16 条上限限制宽泛弱组并保留具体小组", async () => {
    const broad = "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午"
      .split("")
      .map((suffix, index) => relation_candidate(`entry-${index.toString()}`, `共同${suffix}`));
    const result = read_json_record(
      await execute_workspace_method(
        "groupQualityRuleEntries",
        {
          kind: "glossary",
          entries: [
            relation_candidate("specific-left", "共同特甲"),
            relation_candidate("specific-right", "共同特乙"),
            ...broad.slice(2),
          ],
        },
        {},
      ),
    );
    const groups = result["groups"] as JsonRecord[];

    expect(result["total_group_count"]).toBe(16);
    expect(groups[0]).toMatchObject({
      entry_ids: ["specific-left", "specific-right"],
      relations: [
        {
          reason: "shared_root",
          root: "共同特",
          entry_ids: ["specific-left", "specific-right"],
        },
      ],
    });
    expect(groups.slice(1).every((group) => (group["entry_ids"] as string[]).length === 1)).toBe(
      true,
    );
  });

  it("按领域声明的 16 条上限拆分超大强 component 并保留身份与跨组边", async () => {
    const entries = [
      relation_candidate("base", "星海"),
      ..."甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳"
        .split("")
        .map((suffix, index) => relation_candidate(`branch-${index.toString()}`, `星海${suffix}`)),
    ];
    const result = read_json_record(
      await execute_workspace_method("groupQualityRuleEntries", { kind: "glossary", entries }, {}),
    );
    const groups = result["groups"] as JsonRecord[];

    expect(result).toMatchObject({
      total_entry_count: 17,
      total_component_count: 1,
      total_group_count: 2,
    });
    expect(groups.map((group) => (group["entry_ids"] as string[]).length)).toEqual([16, 1]);
    expect(groups.map((group) => group["component_ids"])).toEqual([
      ["component-0001"],
      ["component-0001"],
    ]);
    expect(result["cross_group_relations"]).toEqual([
      expect.objectContaining({
        reason: "contains",
        group_ids: ["group-0001", "group-0002"],
      }),
    ]);
  });

  it("对 text_preserve 只合并完全相同的正则", async () => {
    const result = read_json_record(
      await execute_workspace_method(
        "groupQualityRuleEntries",
        {
          kind: "text_preserve",
          entries: [
            { entry_id: "first", src: "\\\\[A-Z]+" },
            { entry_id: "duplicate", src: "\\\\[A-Z]+" },
            { entry_id: "other", src: "\\\\[a-z]+" },
          ],
        },
        {},
      ),
    );

    expect((result["groups"] as JsonRecord[]).map((group) => group["entry_ids"])).toEqual([
      ["first", "duplicate"],
      ["other"],
    ]);
    expect(result["groups"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relations: [{ reason: "equivalent", entry_ids: ["first", "duplicate"] }],
        }),
      ]),
    );
  });
});
