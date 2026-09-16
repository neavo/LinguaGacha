import { Item } from "../../../domain/item";
import { read_json_record, type JsonValue } from "../../../domain/json";
import type { ProjectDatabase, ProjectDatabaseWrite } from "../../database/database-operations";
import { EpubAst, read_epub_extra } from "../../file/formats/epub/epub-ast";
import { replace_project_file_items } from "../project-open-file-item-replacement";
import type { MigrationDescriptor, ProjectOpenMigrationContext } from "../migration-types";

/**
 * 迁移背景：
 * 旧 EPUB ruby 实现把去注音正文放入 `ruby_clean_candidate`，由 shared 文本层和 writer
 * 读取这一私有字段完成翻译与导出。当前 reader 直接产出应用内可见正文，AST 写回使用
 * `slot_per_line` / `block_text` / `text_run` 定位，不再消费旧候选；`clean_ruby` 只处理字面文本标记。
 *
 * 生效场景：
 * `load_project` 打开旧 EPUB 工程时，若旧候选含 `cleaned_src` 或 `cleaned_digest` 字符串，
 * 则读取工程保存的原始 EPUB asset，按文档路径、原块路径及去注音正文核验对应的 block_text；
 * 缺少正文字符串时比较摘要。只更新这些旧条目的原文和格式定位，保留 ID、行号、译文、姓名、
 * 状态、重试次数及其它条目事实，同文件的普通条目保持原样。
 *
 * 不处理范围：
 * 不将当前 reader 新发现的正文补入旧项目。asset 缺失、解析失败，或任一旧候选无法匹配、
 * 正文或摘要不符、重复占用同一原块时，保留该 EPUB 的全部旧条目；其它文件仍可独立迁移。
 */
export const epub_ruby_block_text_migration: MigrationDescriptor = {
  id: "epub-ruby-block-text",
  order: 800,
  /**
   * EPUB ruby 迁移需要读取 asset 并异步解析，因此只在 project open hook 中生成类型化写入。
   */
  async build_project_open_writes(
    context: ProjectOpenMigrationContext,
  ): Promise<ProjectDatabaseWrite[]> {
    return new EpubRubyBlockTextMigration(context.database).build_writes(context.project_path);
  },
};

/**
 * 负责在项目打开期把旧 EPUB ruby item 转为 block_text；同文件其它条目保持原样。
 */
export class EpubRubyBlockTextMigration {
  private readonly ast = new EpubAst(); // 用当前 reader 核验旧 ruby 块，避免复制解析规则

  /**
   * database 是 `.lg` 唯一读写入口；本类只读取快照并生成类型化写入。
   */
  public constructor(private readonly database: ProjectDatabase) {}

  /**
   * 发现旧 ruby_clean_candidate 后，按原始 EPUB asset 核验正文并更新对应条目。
   */
  public async build_writes(project_path: string): Promise<ProjectDatabaseWrite[]> {
    const current_items = this.read_all_items(project_path);
    const epub_paths = this.collect_legacy_epub_paths(current_items);
    if (epub_paths.size === 0) {
      return [];
    }

    const replacements = new Map<string, Item[]>();
    for (const file_path of epub_paths) {
      const old_file_items = current_items.filter(
        (item) => item.file_type === "EPUB" && item.file_path === file_path,
      );
      const asset_content = this.database.read_asset_content(project_path, file_path);
      if (asset_content === null) {
        continue;
      }
      try {
        const parsed_items = await this.ast.read_from_stream(asset_content, file_path);
        const merged_items = this.merge_file_items(parsed_items, old_file_items);
        if (merged_items !== null) {
          replacements.set(file_path, merged_items);
        }
      } catch {
        // 无法重新解析原始 EPUB 时保留旧项目事实，不能退回运行时兼容分支
      }
    }

    if (replacements.size === 0) {
      return [];
    }

    const replacement_payloads = new Map(
      [...replacements].map(([file_path, items]) => [
        file_path,
        items.map((item) => item.to_json() as unknown as JsonValue),
      ]),
    );
    return [
      (database) => {
        const latest_items = database.get_all_items(project_path);
        database.set_items(
          project_path,
          replace_project_file_items(
            Array.isArray(latest_items) ? latest_items : [],
            replacement_payloads,
          ),
        );
        database.bump_section_revisions(project_path, ["items"]);
      },
    ];
  }

  /**
   * 读取当前 items 快照，迁移决策只依赖打开瞬间的持久事实。
   */
  private read_all_items(project_path: string): Item[] {
    const value = this.database.get_all_items(project_path);
    return Array.isArray(value) ? value.map((item) => Item.from_json(item)) : [];
  }

  /**
   * 只迁移确实带旧候选字段的 EPUB 文件，普通当前 metadata 不参与重写。
   */
  private collect_legacy_epub_paths(items: Item[]): Set<string> {
    const paths = new Set<string>();
    for (const item of items) {
      if (item.file_type === "EPUB" && this.has_legacy_ruby_candidate(item)) {
        paths.add(item.file_path);
      }
    }
    return paths;
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
      merged.push(
        Item.from_json({
          ...old.to_json(),
          src: parsed.src,
          extra_field: parsed.extra_field,
        }),
      );
    }
    return merged;
  }

  /** 文档和原块路径确定身份，提取序号变化不影响匹配。 */
  private block_key(item: Item, block_path: JsonValue | undefined): string {
    return JSON.stringify([read_epub_extra(item)?.["doc_path"] ?? item.tag, block_path]);
  }
}
