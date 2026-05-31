import { Item, read_json_record } from "../../../domain/item";
import type { ProjectDatabase } from "../../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../../database/database-types";
import { EpubAst, read_epub_extra } from "../../file/formats/epub/epub-ast";
import type { MigrationDescriptor, ProjectOpenMigrationContext } from "../migration-types";

/**
 * 迁移背景：
 * 旧 EPUB ruby 实现把去注音正文塞进 `ruby_clean_candidate`，再让 shared 文本层和 writer
 * 读取 EPUB 私有字段完成翻译与导出。当前契约要求 EPUB reader 直接产出应用内可见正文，
 * writer 只消费正式的 `slot_per_line` / `block_text` metadata，`clean_ruby` 只处理字面文本标记。
 *
 * 生效场景：
 * `load_project` 打开旧 EPUB 工程时，若 item metadata 中仍含 `ruby_clean_candidate`，
 * 则按原始 EPUB asset 用当前 reader 重建该文件 item，并迁移用户翻译、姓名、状态和重试事实。
 *
 * 不处理范围：
 * 无法重新解析 asset 或存在无法映射的用户事实时保留旧项目事实，不提供运行时兼容旁路。
 */
export const epub_ruby_block_text_migration: MigrationDescriptor = {
  id: "epub-ruby-block-text",
  order: 800,
  /**
   * EPUB ruby 迁移需要读取 asset 并异步解析，因此只在 project open operation hook 中生成写回操作。
   */
  async build_project_open_operations(
    context: ProjectOpenMigrationContext,
  ): Promise<DatabaseOperation[]> {
    return new EpubRubyBlockTextMigration(context.database).build_operations(context.project_path);
  },
};

/**
 * 负责在项目打开期把旧 EPUB ruby item 重建为当前 block_text item，并迁移用户事实。
 */
export class EpubRubyBlockTextMigration {
  private readonly ast = new EpubAst(); // 使用当前 EPUB reader 契约重建 item，迁移不复制旧解析规则

  /**
   * database 是 `.lg` 唯一读写入口；本类只读取快照并生成 operation。
   */
  public constructor(private readonly database: ProjectDatabase) {}

  /**
   * 发现旧 ruby_clean_candidate 后，按原始 EPUB asset 重建当前 item 形状并迁移用户事实。
   */
  public async build_operations(project_path: string): Promise<DatabaseOperation[]> {
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

    return [
      {
        name: "setItems",
        args: {
          projectPath: project_path,
          items: this.replace_items_by_file(
            current_items,
            replacements,
          ) as unknown as DatabaseJsonValue,
        },
      },
      {
        name: "deleteAnalysisItemCheckpoints",
        args: { projectPath: project_path },
      },
      {
        name: "clearAnalysisCandidateAggregates",
        args: { projectPath: project_path },
      },
      {
        name: "upsertMetaEntries",
        args: {
          projectPath: project_path,
          meta: {
            analysis_extras: {},
            analysis_candidate_count: 0,
          } as unknown as DatabaseJsonValue,
        },
      },
      {
        name: "bumpSectionRevisions",
        args: {
          projectPath: project_path,
          sections: ["items", "analysis"],
        },
      },
    ];
  }

  /**
   * 读取当前 items 快照，迁移决策只依赖打开瞬间的持久事实。
   */
  private read_all_items(project_path: string): Item[] {
    const value = this.database.execute({
      name: "getAllItems",
      args: { projectPath: project_path },
    });
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
   * 新旧 item 以结构 key 优先对齐，ruby 旧候选再用 block_path 补齐映射。
   */
  private merge_file_items(parsed_items: Item[], old_items: Item[]): Item[] | null {
    const consumed_old_items = new Set<Item>();
    const by_structural_key = this.build_item_index(old_items, (item) =>
      this.structural_item_key(item),
    );
    const by_ruby_block_key = this.build_item_index(old_items, (item) =>
      this.legacy_ruby_block_key(item),
    );
    const by_row_key = this.build_item_index(old_items, (item) => this.row_item_key(item));
    const merged_items: Item[] = [];

    for (const parsed_item of parsed_items) {
      const old_item =
        this.take_indexed_item(
          by_structural_key,
          this.structural_item_key(parsed_item),
          consumed_old_items,
        ) ??
        this.take_indexed_item(
          by_ruby_block_key,
          this.block_text_item_key(parsed_item),
          consumed_old_items,
        ) ??
        this.take_indexed_item(by_row_key, this.row_item_key(parsed_item), consumed_old_items);
      if (old_item === null) {
        merged_items.push(parsed_item);
        continue;
      }
      consumed_old_items.add(old_item);
      merged_items.push(this.merge_user_facts(parsed_item, old_item));
    }

    const unsafe_unmapped_item = old_items.some(
      (old_item) => !consumed_old_items.has(old_item) && this.has_user_fact(old_item),
    );
    return unsafe_unmapped_item ? null : merged_items;
  }

  /**
   * 全量 setItems 必须保留未迁移文件原顺序，只在原 EPUB 文件位置替换重建结果。
   */
  private replace_items_by_file(
    current_items: Item[],
    replacements: Map<string, Item[]>,
  ): DatabaseJsonValue[] {
    const emitted_files = new Set<string>();
    const next_items: DatabaseJsonValue[] = [];
    for (const item of current_items) {
      const replacement = replacements.get(item.file_path);
      if (item.file_type === "EPUB" && replacement !== undefined) {
        if (!emitted_files.has(item.file_path)) {
          next_items.push(
            ...(replacement.map((next_item) =>
              next_item.to_json(),
            ) as unknown as DatabaseJsonValue[]),
          );
          emitted_files.add(item.file_path);
        }
        continue;
      }
      next_items.push(item.to_json() as unknown as DatabaseJsonValue);
    }
    return next_items;
  }

  /**
   * 迁移只替换 EPUB 结构 metadata，用户已经产生的翻译、姓名和状态事实必须保留。
   */
  private merge_user_facts(parsed_item: Item, old_item: Item): Item {
    return Item.from_json({
      ...parsed_item.to_json(),
      id: old_item.id,
      dst: old_item.dst,
      name_src: old_item.name_src,
      name_dst: old_item.name_dst,
      text_type: old_item.text_type,
      status: old_item.status,
      retry_count: old_item.retry_count,
    });
  }

  /**
   * 有用户事实的旧 item 若无法映射，整本 EPUB 保留原状，避免静默丢译文。
   */
  private has_user_fact(item: Item): boolean {
    return (
      item.dst !== "" ||
      this.has_name_value(item.name_src) ||
      this.has_name_value(item.name_dst) ||
      item.status !== "NONE" ||
      item.retry_count > 0
    );
  }

  /**
   * 姓名字段可能是单列或多列，只要含非空文本就视为用户事实。
   */
  private has_name_value(value: string | string[] | null): boolean {
    if (typeof value === "string") {
      return value !== "";
    }
    return Array.isArray(value) && value.some((entry) => entry !== "");
  }

  /**
   * 构建一对多索引，重复 key 按原 item 顺序消费，避免相同文本块互相抢占。
   */
  private build_item_index(
    items: Item[],
    key_reader: (item: Item) => string | null,
  ): Map<string, Item[]> {
    const index = new Map<string, Item[]>();
    for (const item of items) {
      const key = key_reader(item);
      if (key === null) {
        continue;
      }
      const bucket = index.get(key) ?? [];
      bucket.push(item);
      index.set(key, bucket);
    }
    return index;
  }

  /**
   * 从索引中取第一个未消费 item，保证同一个旧事实只能迁移一次。
   */
  private take_indexed_item(
    index: Map<string, Item[]>,
    key: string | null,
    consumed_items: Set<Item>,
  ): Item | null {
    if (key === null) {
      return null;
    }
    const bucket = index.get(key);
    while (bucket !== undefined && bucket.length > 0) {
      const item = bucket.shift() as Item;
      if (!consumed_items.has(item)) {
        return item;
      }
    }
    return null;
  }

  /**
   * 结构 key 绑定文件、文档、行号和块路径，覆盖普通 slot 与新 block_text 项。
   */
  private structural_item_key(item: Item): string | null {
    const epub = read_epub_extra(item);
    if (epub === null) {
      return null;
    }
    const doc_path = String(epub["doc_path"] ?? item.tag);
    const block_path = String(epub["block_path"] ?? "");
    return [item.file_path, item.tag, String(item.row), doc_path, block_path].join("\u0000");
  }

  /**
   * 行号 key 只作为最后兜底，服务旧 metadata 缺少 block_path 的低风险场景。
   */
  private row_item_key(item: Item): string | null {
    if (item.file_type !== "EPUB") {
      return null;
    }
    return [item.file_path, item.tag, String(item.row)].join("\u0000");
  }

  /**
   * 新 block_text 项使用正式 block_path 与旧候选的 block_path 对齐。
   */
  private block_text_item_key(item: Item): string | null {
    const epub = read_epub_extra(item);
    if (epub?.["mode"] !== "block_text") {
      return null;
    }
    const doc_path = String(epub["doc_path"] ?? item.tag);
    const block_path = String(epub["block_path"] ?? "");
    return block_path === "" ? null : [item.file_path, doc_path, block_path].join("\u0000");
  }

  /**
   * 旧候选的 block_path 是从旧 reader 写入的唯一稳定 ruby 块定位。
   */
  private legacy_ruby_block_key(item: Item): string | null {
    const epub = read_epub_extra(item);
    const candidate = read_json_record(epub?.["ruby_clean_candidate"]);
    const block_path = String(candidate["block_path"] ?? epub?.["block_path"] ?? "");
    if (epub === null || block_path === "") {
      return null;
    }
    const doc_path = String(epub["doc_path"] ?? item.tag);
    return [item.file_path, doc_path, block_path].join("\u0000");
  }
}
