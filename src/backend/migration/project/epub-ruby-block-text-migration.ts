import { type Item, create_item } from "../../../domain/item";
import { read_json_record, type JsonValue } from "../../../domain/json";
import type { ProjectDatabase, ProjectDatabaseWrite } from "../../database/database-operations";
import { EpubAst, read_epub_extra } from "../../file/epub/epub-ast";
import { replace_project_file_items } from "./project-file-item-replacement";

/**
 * 迁移背景：
 * 旧 EPUB 将去注音正文放在 `ruby_clean_candidate`，当前 reader 直接输出正文和 AST 定位。
 * 打开旧工程需要把候选条目转换为 `block_text`，让翻译与导出消费同一份正文。
 *
 * 生效场景：
 * 候选含 `cleaned_src` 或 `cleaned_digest` 时，读取原资产，按文档路径和原块路径匹配。
 * 正文优先于摘要参与核验。同一原块只允许匹配一次，整份文件验证通过后才生成替换写入。
 * 候选条目继承现有 Item 字段并更新正文及 `extra_field`。提交时重读集合，保留前序迁移结果。
 *
 * 不处理范围：
 * 原资产缺失、解析失败或任一候选不匹配时，该文件保留旧条目。新发现的正文留给重新导入。
 * 目标文件沿用当前 Item 投影，未知顶层字段会被舍弃。字段保留策略属于独立行为修正。
 */
export class EpubRubyBlockTextMigration {
  private readonly ast = new EpubAst(); // 用当前 reader 核验旧 ruby 块，避免复制解析规则

  /**
   * database 是 `.lg` 唯一读写入口。本类只读取快照并生成类型化写入。
   */
  public constructor(private readonly database: ProjectDatabase) {}

  /**
   * 发现旧 ruby_clean_candidate 后，按原始 EPUB asset 核验正文并更新对应条目。
   */
  public async build_writes(
    project_path: string,
    raw_items: readonly JsonValue[],
  ): Promise<ProjectDatabaseWrite[]> {
    const items_by_path = new Map<string, Item[]>();
    const epub_paths = new Set<string>(); // 按旧候选首次出现顺序读取资产。
    for (const value of raw_items) {
      const item = create_item(value);
      if (item.file_type !== "EPUB") continue;
      const items = items_by_path.get(item.file_path) ?? [];
      items.push(item);
      items_by_path.set(item.file_path, items);
      if (this.has_legacy_ruby_candidate(item)) epub_paths.add(item.file_path);
    }
    if (epub_paths.size === 0) {
      return [];
    }

    const replacements = new Map<string, JsonValue[]>();
    for (const file_path of epub_paths) {
      const old_file_items = items_by_path.get(file_path)!;
      const asset_content = this.database.read_asset_content(project_path, file_path);
      if (asset_content === null) {
        continue;
      }
      let merged_items: Item[] | null;
      try {
        const parsed_items = await this.ast.read_from_stream(asset_content, file_path);
        merged_items = this.merge_file_items(parsed_items, old_file_items);
      } catch {
        // 无法重新解析原始 EPUB 时保留旧项目事实，不能退回运行时兼容分支
        continue;
      }
      if (merged_items !== null) {
        replacements.set(file_path, merged_items);
      }
    }

    if (replacements.size === 0) {
      return [];
    }

    return [
      (database) => {
        const latest_items = database.get_all_items(project_path);
        database.set_items(project_path, replace_project_file_items(latest_items, replacements));
        database.bump_section_revisions(project_path, ["items"]);
      },
    ];
  }

  /**
   * 旧候选字段是唯一触发条件，避免误改仍然有效的普通 EPUB 项。
   */
  private has_legacy_ruby_candidate(item: Item): boolean {
    const epub = read_epub_extra(item);
    const candidate = read_json_record(epub?.["ruby_clean_candidate"]);
    return (
      typeof candidate["cleaned_src"] === "string" ||
      typeof candidate["cleaned_digest"] === "string"
    );
  }

  /**
   * 迁移只处理旧注音条目。当前 reader 可以发现更多正文，但不能借打开旧项目改变条目集合。
   * 原路径与去注音正文共同确认身份，避免提取顺序变化后按行号误继承译文。
   */
  private merge_file_items(parsed_items: Item[], old_items: Item[]): Item[] | null {
    const parsed_by_block = new Map<string, Item>();
    for (const item of parsed_items) {
      const epub = read_epub_extra(item);
      if (epub?.["mode"] === "block_text") {
        parsed_by_block.set(this.block_key(item, epub["block_path"]), item);
      }
    }
    const merged: Item[] = [];
    for (const old of old_items) {
      if (!this.has_legacy_ruby_candidate(old)) {
        merged.push(old);
        continue;
      }
      const epub = read_epub_extra(old);
      const candidate = read_json_record(epub?.["ruby_clean_candidate"]);
      const key = this.block_key(old, candidate["block_path"] ?? epub?.["block_path"]);
      const parsed = parsed_by_block.get(key);
      if (parsed === undefined) return null;
      const matches =
        typeof candidate["cleaned_src"] === "string"
          ? candidate["cleaned_src"] === parsed.src
          : candidate["cleaned_digest"] === read_epub_extra(parsed)?.["src_digest"];
      if (!matches) return null;
      parsed_by_block.delete(key); // 同一原块只能迁移一次，避免把重复候选当成独立条目。
      merged.push({
        ...old,
        src: parsed.src,
        extra_field: parsed.extra_field,
      });
    }
    return merged;
  }

  /** 文档和原块路径确定身份，提取序号变化不影响匹配。 */
  private block_key(item: Item, block_path: JsonValue | undefined): string {
    return JSON.stringify([read_epub_extra(item)?.["doc_path"] ?? item.tag, block_path]);
  }
}
