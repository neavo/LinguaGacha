import { read_translation_for_generation } from "../translation-generation-text";
import JSZip from "jszip";
import render from "dom-serializer";
import { Element, isTag, Text, type ChildNode } from "domhandler";
import { write_zip, type ZipContents } from "./epub-zip";

import type { Item } from "../../../domain/item";
import { read_json_record, type JsonRecord } from "../../../domain/json";
import { write_binary_file, type FileFormatServiceConfig } from "../file-format-shared";
import { EpubAst, read_epub_extra, read_epub_text_run } from "./epub-ast";
import { split_text_lines } from "../../../shared/text/text-lines";

/** 按固定槽位分配文本；缺行补空，超出的行合并到末槽。 */
export function distribute_text_to_slots(text: string, slot_count: number): string[] {
  const lines = split_text_lines(text);
  return Array.from({ length: Math.max(0, slot_count) }, (_, index) =>
    index === slot_count - 1 ? lines.slice(index).join("\n") : (lines[index] ?? ""),
  );
}

/**
 * 目标语言不保留原排版时，导出写回会移除竖排样式
 */
const CSS_VERTICAL_WRITING_PATTERN = /[^;\s]*writing-mode\s*:\s*vertical-rl;*/giu;
const EPUB_READING_LAYOUT_TARGET_LANGUAGES = new Set(["JA", "ZH-HANT"]); // 日文与繁中导出保留原 EPUB 翻页方向和竖排信息

/**
 * 顺序写回只处理这些块级标签，避免在内联节点中错位替换
 */
const EPUB_LEGACY_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "div", "li", "td"]);

type EpubDocumentSyntax = "xml" | "html";

type EpubTextRun = { container: Element; nodes: ChildNode[] };

/**
 * EPUB 写回器，优先使用 AST 定位，缺少正式 metadata 时回退顺序写回
 * 单值类的正文生效规则见 `read_translation_for_generation()`。
 */
export class EpubWriter {
  /**
   * AST 工具集中提供路径、slot、解析和正文组装能力，写回器不重复实现 DOM 细节
   */
  private readonly ast = new EpubAst();

  /**
   * 目标语言阅读排版策略在构造时固定，保证 AST 和 legacy 写回路径一致
   */
  private readonly preserve_reading_layout: boolean;

  /**
   * 写回策略依赖导出配置，尤其是双语去重和目标语言路径规则
   */
  public constructor(private readonly config: FileFormatServiceConfig) {
    this.preserve_reading_layout = EPUB_READING_LAYOUT_TARGET_LANGUAGES.has(
      config.target_language.trim().toUpperCase(),
    );
  }

  /**
   * 三种正式 AST 模式共用原树定位，旧无 metadata 项才走 legacy
   */
  public has_epub_ast_metadata(item: Item): boolean {
    const epub = read_epub_extra(item);
    const mode = String(epub?.["mode"] ?? "");
    if (mode === "text_run" && epub !== null) {
      return read_epub_text_run(epub) !== null && typeof epub["src_digest"] === "string";
    }
    if (mode === "block_text") {
      return (
        typeof epub?.["doc_path"] === "string" &&
        typeof epub["block_path"] === "string" &&
        typeof epub["src_digest"] === "string" &&
        epub["src_digest"] !== ""
      );
    }
    if (mode !== "slot_per_line") {
      return false;
    }
    const parts = epub?.["parts"];
    return Array.isArray(parts) && parts.length > 0;
  }

  /**
   * 根据条目元数据选择 AST 或顺序写回路径，保证项目能导出
   */
  public async build_epub(
    original_epub_bytes: Uint8Array,
    items: Item[],
    out_path: string,
    bilingual: boolean,
  ): Promise<void> {
    const use_ast = items.every((item) => this.has_epub_ast_metadata(item));
    if (use_ast) {
      await this.build_epub_ast(original_epub_bytes, items, out_path, bilingual);
      return;
    }
    await this.build_epub_legacy(original_epub_bytes, items, out_path, bilingual);
  }

  /**
   * AST 写回按 EPUB 内文档聚合条目，逐文件应用 slot 级替换并保留其它资源
   */
  private async build_epub_ast(
    original_epub_bytes: Uint8Array,
    items: Item[],
    out_path: string,
    bilingual: boolean,
  ): Promise<void> {
    const by_doc = new Map<string, Item[]>();
    for (const item of items.filter((candidate) => candidate.file_type === "EPUB")) {
      const epub = read_epub_extra(item);
      if (epub === null) {
        continue;
      }
      const doc_path = String(epub["doc_path"] ?? item.tag ?? "");
      if (doc_path === "") {
        continue;
      }
      const bucket = by_doc.get(doc_path) ?? [];
      bucket.push(item);
      by_doc.set(doc_path, bucket);
    }
    for (const doc_items of by_doc.values()) {
      doc_items.sort((left, right) => left.row - right.row);
    }

    const source_zip = await JSZip.loadAsync(original_epub_bytes);
    const output_zip: ZipContents = new Map();
    // OPF 先写一次，只有实际写入的标题才用于后续 XHTML 同步。
    let opf_title_sync_pair: [string, string] | null = null;
    for (const [name, file] of Object.entries(source_zip.files)) {
      if (!name.toLowerCase().endsWith(".opf") || file.dir) continue;
      const pair = await this.write_opf_doc(
        output_zip,
        name,
        await file.async("uint8array"),
        by_doc.get(name) ?? [],
        bilingual,
      );
      opf_title_sync_pair ??= pair;
    }

    for (const name of Object.keys(source_zip.files)) {
      // OPF 已在前一轮写出，跳过解压和重复处理。
      if (name.toLowerCase().endsWith(".opf")) continue;
      const file = (await source_zip.file(name)?.async("uint8array")) ?? null;
      if (file === null) {
        continue;
      }
      const raw = file;
      const lower = name.toLowerCase();
      const is_html_document = this.ast.is_html_document_path(name);

      if (lower.endsWith(".css")) {
        output_zip.set(name, this.sanitize_css(this.ast.decode_bytes(raw)));
        continue;
      }
      if (
        (is_html_document || lower.endsWith(".ncx")) &&
        (by_doc.has(name) || (opf_title_sync_pair !== null && is_html_document))
      ) {
        await this.write_ast_content_doc(
          output_zip,
          name,
          raw,
          by_doc.get(name) ?? [],
          bilingual,
          opf_title_sync_pair,
        );
        continue;
      }
      output_zip.set(name, raw);
    }

    await this.write_zip_file(output_zip, out_path);
  }

  /**
   * OPF 写回失败时回退原文加清洗，元数据文件不能阻塞正文导出
   */
  private async write_opf_doc(
    output_zip: ZipContents,
    name: string,
    raw: Uint8Array,
    doc_items: Item[],
    bilingual: boolean,
  ): Promise<[string, string] | null> {
    if (doc_items.length === 0) {
      output_zip.set(name, this.sanitize_opf(this.ast.decode_bytes(raw)));
      return null;
    }
    try {
      const root = this.ast.parse_opf_xml(raw);
      const [applied, title] = this.apply_items_to_tree(root, name, doc_items, bilingual);
      const text = applied > 0 ? this.serialize_doc(name, root) : this.ast.decode_bytes(raw);
      output_zip.set(name, this.sanitize_opf(text));
      return title;
    } catch {
      output_zip.set(name, this.sanitize_opf(this.ast.decode_bytes(raw)));
      return null;
    }
  }

  /**
   * XHTML/NCX 写回在 AST 定位失败时保留原始文档，避免损坏 EPUB 包
   */
  private async write_ast_content_doc(
    output_zip: ZipContents,
    name: string,
    raw: Uint8Array,
    doc_items: Item[],
    bilingual: boolean,
    opf_title_sync_pair: [string, string] | null,
  ): Promise<void> {
    try {
      const root = name.toLowerCase().endsWith(".ncx")
        ? this.ast.parse_ncx_xml(raw)
        : this.ast.parse_xhtml_or_html(raw);
      let changed = false;
      if (doc_items.length > 0) {
        this.apply_items_to_tree(root, name, doc_items, bilingual);
        changed = true;
      }
      if (opf_title_sync_pair !== null && this.ast.is_html_document_path(name)) {
        const [src_title, dst_title] = opf_title_sync_pair;
        if (this.sync_xhtml_title(root, src_title, dst_title)) {
          changed = true;
        }
      }
      output_zip.set(name, changed ? this.serialize_doc(name, root) : raw);
    } catch {
      output_zip.set(name, raw);
    }
  }

  /**
   * 将译文应用到 DOM slot，并在双语模式下收集需要插入的原文块克隆
   */
  private apply_items_to_tree(
    root: Element,
    doc_path: string,
    items: Item[],
    bilingual: boolean,
  ): [number, [string, string] | null] {
    let title: [string, string] | null = null; // 仅记录实际写入的 OPF 标题，供 XHTML 同步。
    let applied = 0;
    const doc_lower = doc_path.toLowerCase();
    const is_ncx = doc_lower.endsWith(".ncx") || this.ast.local_name(root.name) === "ncx";
    const is_opf =
      doc_lower.endsWith(".opf") || this.ast.local_name(root.name).toLowerCase() === "package";
    const is_nav_flag = items.some((item) => read_epub_extra(item)?.["is_nav"] === true);
    const allow_bilingual_insert =
      bilingual && !this.ast.is_nav_page(root) && !is_nav_flag && !is_ncx && !is_opf;
    const elem_by_path = this.ast.build_elem_by_path(root);
    // 区间基于原始 DOM，必须在任何条目改写或双语插入之前解析为节点引用。
    const text_runs = this.resolve_text_runs(elem_by_path, items);
    const block_refs: Array<[Element, Element]> = [];
    const inserted_block_paths = new Set<string>();

    for (const item of items) {
      const epub = read_epub_extra(item);
      const mode = String(epub?.["mode"] ?? "");
      if (epub === null) {
        continue;
      }
      const item_dst = this.read_output_text(item, is_opf || is_ncx || is_nav_flag);
      if (mode === "text_run") {
        const run = text_runs.get(item);
        if (run !== undefined) {
          this.apply_text_run(run, item, item_dst, allow_bilingual_insert);
          applied += 1;
        }
        continue;
      }
      if (mode === "block_text") {
        if (
          this.apply_block_text_item_to_tree(
            root,
            elem_by_path,
            epub,
            item,
            item_dst,
            allow_bilingual_insert,
            block_refs,
            inserted_block_paths,
          )
        ) {
          applied += 1;
        }
        continue;
      }

      const parts = epub?.["parts"];
      const src_digest = epub?.["src_digest"];
      if (
        mode !== "slot_per_line" ||
        !Array.isArray(parts) ||
        parts.length === 0 ||
        typeof src_digest !== "string" ||
        src_digest === ""
      ) {
        continue;
      }

      const dst_lines = distribute_text_to_slots(item_dst, parts.length);

      const current_texts: string[] = [];
      const resolved: Array<[string, Element]> = [];
      let ok = true;
      for (const part of parts) {
        const part_record = read_json_record(part);
        const slot = String(part_record["slot"] ?? "");
        const elem_path = String(part_record["path"] ?? "");
        if (slot !== "text" && slot !== "tail") {
          ok = false;
          break;
        }
        const elem = elem_by_path.get(elem_path) ?? this.ast.find_by_path(root, elem_path);
        if (elem === null) {
          ok = false;
          break;
        }
        current_texts.push(
          this.ast.normalize_slot_text(
            slot === "text" ? this.ast.read_text_slot(elem) : this.ast.read_tail_slot(elem),
          ),
        );
        resolved.push([slot, elem]);
      }

      if (!ok || this.ast.sha1_hex_with_null_separator(current_texts) !== src_digest) {
        continue;
      }

      if (
        allow_bilingual_insert &&
        !(this.config.deduplication_in_bilingual === true && item.src === item_dst)
      ) {
        const block_path = typeof epub["block_path"] === "string" ? epub["block_path"] : "";
        this.collect_bilingual_block_ref(
          root,
          elem_by_path,
          block_path,
          block_refs,
          inserted_block_paths,
        );
      }

      resolved.forEach(([slot, elem], index) => {
        const safe_text = this.ast.sanitize_xml_text(dst_lines[index] ?? "");
        if (slot === "text") {
          this.ast.write_text_slot(elem, safe_text);
        } else {
          this.ast.write_tail_slot(elem, safe_text);
        }
      });
      applied += 1;
      if (
        epub["is_opf_metadata"] === true &&
        epub["metadata_tag"] === "dc:title" &&
        item.status === "PROCESSED" &&
        item_dst !== item.src &&
        split_text_lines(item.src).length === 1 &&
        split_text_lines(item_dst).length === 1
      ) {
        title ??= [item.src, item_dst];
      }
    }

    if (allow_bilingual_insert) {
      for (const [block, clone] of [...block_refs].reverse()) {
        const parent = block.parent;
        if (!(parent instanceof Element)) {
          continue;
        }
        const style = String(clone.attribs["style"] ?? "").replace(/;+$/u, "");
        clone.attribs["style"] = `${style}${style === "" ? "" : ";"}opacity:0.50;`;
        const index = parent.children.indexOf(block);
        if (index < 0) {
          continue;
        }
        clone.parent = parent;
        parent.children.splice(index, 0, clone);
        clone.next = block;
        clone.prev = index > 0 ? (parent.children[index - 1] as ChildNode) : null;
        block.prev = clone;
        clone.children.push(new Text(""));
      }
    }

    return [applied, title];
  }

  /** 以原节点范围和摘要核验片段，避免解析变化后把译文写到其它正文。 */
  private resolve_text_runs(
    elem_by_path: Map<string, Element>,
    items: Item[],
  ): Map<Item, EpubTextRun> {
    const runs = new Map<Item, EpubTextRun>();
    for (const item of items) {
      const epub = read_epub_extra(item);
      if (epub?.["mode"] !== "text_run") continue;
      const ref = read_epub_text_run(epub);
      if (ref === null) continue;
      const container = elem_by_path.get(ref.container_path);
      if (container === undefined || ref.end > container.children.length) continue;
      const nodes = container.children.slice(ref.start, ref.end);
      if (this.ast.sha1_hex(this.ast.build_canonical_nodes_text(nodes)) !== epub["src_digest"])
        continue;
      runs.set(item, { container, nodes });
    }
    return runs;
  }

  /** 片段不含图片、链接或锚点边界；译文替换片段，双语只复制该片段的原文。 */
  private apply_text_run(run: EpubTextRun, item: Item, text: string, bilingual: boolean): void {
    // 未翻译片段保留原内联排版；双语明确要求重复原文时才继续插入。
    if (item.src === text && (!bilingual || this.config.deduplication_in_bilingual === true))
      return;
    const { container, nodes } = run;
    const start = container.children.indexOf(nodes[0] as ChildNode);
    const replacements: ChildNode[] = [];
    if (bilingual && !(this.config.deduplication_in_bilingual === true && item.src === text)) {
      const original = new Element("span", { style: "opacity:0.50;" }, []);
      this.ast.replace_element_children(original, nodes);
      replacements.push(original);
      if (text !== "") replacements.push(new Element("br", {}, []));
    }
    if (text !== "" || !bilingual) replacements.push(new Text(this.ast.sanitize_xml_text(text)));
    const children = [...container.children];
    children.splice(start, nodes.length, ...replacements);
    this.ast.replace_element_children(container, children);
  }

  /**
   * `block_text` 按整块正文校验，译文写回保留原树的结构节点。
   */
  private apply_block_text_item_to_tree(
    root: Element,
    elem_by_path: Map<string, Element>,
    epub: JsonRecord,
    item: Item,
    item_dst: string,
    allow_bilingual_insert: boolean,
    block_refs: Array<[Element, Element]>,
    inserted_block_paths: Set<string>,
  ): boolean {
    const block_path = typeof epub["block_path"] === "string" ? epub["block_path"] : "";
    const src_digest = typeof epub["src_digest"] === "string" ? epub["src_digest"] : "";
    if (block_path === "" || src_digest === "") {
      return false;
    }
    const block_elem = elem_by_path.get(block_path) ?? this.ast.find_by_path(root, block_path);
    if (block_elem === null) {
      return false;
    }
    const current_src = this.ast.build_canonical_block_text(block_elem);
    if (this.ast.sha1_hex(current_src) !== src_digest) {
      return false;
    }
    if (
      item.src === item_dst &&
      (!allow_bilingual_insert || this.config.deduplication_in_bilingual === true)
    )
      return true;
    if (
      allow_bilingual_insert &&
      !(this.config.deduplication_in_bilingual === true && item.src === item_dst)
    ) {
      this.collect_bilingual_block_ref(
        root,
        elem_by_path,
        block_path,
        block_refs,
        inserted_block_paths,
      );
    }
    this.ast.write_block_translation(block_elem, item_dst);
    return true;
  }

  /**
   * 双语插入按 block_path 去重，避免同一原文块被多个 slot 重复克隆
   */
  private collect_bilingual_block_ref(
    root: Element,
    elem_by_path: Map<string, Element>,
    block_path: string,
    block_refs: Array<[Element, Element]>,
    inserted_block_paths: Set<string>,
  ): void {
    if (block_path === "" || inserted_block_paths.has(block_path)) {
      return;
    }
    const block_elem = elem_by_path.get(block_path) ?? this.ast.find_by_path(root, block_path);
    if (block_elem === null) {
      return;
    }
    block_refs.push([block_elem, this.ast.clone_element(block_elem)]);
    inserted_block_paths.add(block_path);
  }

  /**
   * OPF 书名变更时同步 XHTML head/title，只改完全匹配原标题的节点
   */
  private sync_xhtml_title(root: Element, src_title: string, dst_title: string): boolean {
    let changed = false;
    for (const head of this.ast.find_descendants(root, "head")) {
      for (const title_elem of this.ast.iter_children_elements(head)) {
        if (this.ast.local_name(title_elem.name) !== "title") {
          continue;
        }
        const current_text = this.ast.normalize_slot_text(this.ast.read_text_slot(title_elem));
        if (current_text !== src_title) {
          continue;
        }
        this.ast.write_text_slot(title_elem, this.ast.sanitize_xml_text(dst_title));
        changed = true;
      }
    }
    return changed;
  }

  /**
   * 顺序写回使用顺序替换策略，服务缺少 AST 元数据的项目
   */
  private async build_epub_legacy(
    original_epub_bytes: Uint8Array,
    items: Item[],
    out_path: string,
    bilingual: boolean,
  ): Promise<void> {
    const sorted_items = items
      .filter((item) => item.file_type === "EPUB")
      .sort((left, right) => left.row - right.row);
    const tag_group = new Map<string, Item[]>();
    for (const item of sorted_items) {
      const bucket = tag_group.get(item.tag) ?? [];
      bucket.push(item);
      tag_group.set(item.tag, bucket);
    }

    const source_zip = await JSZip.loadAsync(original_epub_bytes);
    const output_zip: ZipContents = new Map();
    for (const name of Object.keys(source_zip.files)) {
      const file = (await source_zip.file(name)?.async("uint8array")) ?? null;
      if (file === null) {
        continue;
      }
      const raw = file;
      const lower = name.toLowerCase();
      if (lower.endsWith(".css")) {
        output_zip.set(name, this.sanitize_css(this.ast.decode_bytes(raw)));
      } else if (lower.endsWith(".opf")) {
        output_zip.set(name, this.sanitize_opf(this.ast.decode_bytes(raw)));
      } else if (lower.endsWith(".ncx")) {
        output_zip.set(name, this.process_legacy_ncx(name, raw, tag_group.get(name) ?? []));
      } else if (this.ast.is_html_document_path(name)) {
        output_zip.set(
          name,
          this.process_legacy_html(name, raw, tag_group.get(name) ?? [], bilingual),
        );
      } else {
        output_zip.set(name, raw);
      }
    }
    await this.write_zip_file(output_zip, out_path);
  }

  /**
   * NCX 顺序写回按 text 节点顺序消费条目
   */
  private process_legacy_ncx(name: string, raw: Uint8Array, target_items: Item[]): string {
    const root = this.ast.parse_ncx_xml(raw);
    let item_index = 0;
    for (const text_elem of this.ast.find_descendants(root, "text")) {
      if (this.ast.read_text_slot(text_elem).trim() === "" || item_index >= target_items.length) {
        continue;
      }
      this.ast.write_text_slot(text_elem, this.read_output_text(target_items[item_index]!, true));
      item_index += 1;
    }
    return this.serialize_doc(name, root);
  }

  /**
   * HTML legacy 写回按块级标签顺序替换，并在双语模式插入原文克隆
   */
  private process_legacy_html(
    name: string,
    raw: Uint8Array,
    target_items: Item[],
    bilingual: boolean,
  ): string {
    const root = this.ast.parse_xhtml_or_html(raw);
    const is_nav_page = this.ast.is_nav_page(root);
    let item_index = 0;
    for (const dom of this.ast.flatten_elements(root)) {
      if (!this.preserve_reading_layout) {
        this.remove_vertical_style(dom);
      }
      if (!EPUB_LEGACY_TAGS.has(this.ast.local_name(dom.name))) {
        continue;
      }
      if (
        this.collect_text_content(dom).trim() === "" ||
        this.has_legacy_tag_descendant(dom) ||
        item_index >= target_items.length
      ) {
        continue;
      }
      const item = target_items[item_index] as Item;
      const item_dst = this.read_output_text(item, is_nav_page);
      if (
        bilingual &&
        !is_nav_page &&
        !(this.config.deduplication_in_bilingual === true && item.src === item_dst)
      ) {
        const parent = dom.parent;
        if (parent instanceof Element) {
          const clone = this.ast.clone_element(dom);
          const style = String(clone.attribs["style"] ?? "").replace(/;+$/u, "");
          clone.attribs["style"] = `${style}${style === "" ? "" : ";"}opacity:0.50;`;
          const index = parent.children.indexOf(dom);
          clone.parent = parent;
          parent.children.splice(index, 0, new Text("\n"), clone);
        }
      }
      if (item.src !== item_dst) this.ast.write_block_translation(dom, item_dst);
      item_index += 1;
    }
    return this.serialize_doc(name, root);
  }

  /** 受限位置回源保证 EPUB 可交付，工程中的已确认空值仍原样保存。 */
  private read_output_text(item: Item, requires_text: boolean): string {
    const text = read_translation_for_generation(item) ?? item.src;
    return requires_text && text.trim() === "" ? item.src : text;
  }

  /** 导出时按目标语言移除竖排样式。 */
  private remove_vertical_style(dom: Element): void {
    const class_attr = dom.attribs["class"];
    if (class_attr !== undefined) {
      const cleaned = class_attr.replace(/[hv]rtl|[hv]ltr/giu, "").trim();
      if (cleaned === "") {
        delete dom.attribs["class"];
      } else {
        dom.attribs["class"] = cleaned.split(/\s+/u).join(" ");
      }
    }
    const style_attr = dom.attribs["style"];
    if (style_attr !== undefined) {
      const cleaned = style_attr.replace(CSS_VERTICAL_WRITING_PATTERN, "").trim();
      if (cleaned === "") {
        delete dom.attribs["style"];
      } else {
        dom.attribs["style"] = cleaned;
      }
    }
  }

  /**
   * 顺序写回块不能包含另一个候选块，否则替换会同时命中父子节点
   */
  private has_legacy_tag_descendant(dom: Element): boolean {
    return this.ast
      .flatten_elements(dom)
      .slice(1)
      .some((elem) => EPUB_LEGACY_TAGS.has(this.ast.local_name(elem.name)));
  }

  /**
   * 递归收集元素可见文本，供空文本过滤和字符串替换判断使用
   */
  private collect_text_content(elem: Element): string {
    const parts: string[] = [];
    for (const child of elem.children) {
      if (isTag(child)) {
        parts.push(this.collect_text_content(child));
      } else if (child instanceof Text) {
        parts.push(child.data);
      }
    }
    return parts.join("");
  }

  /**
   * OPF 清洗在横排目标语言下去掉翻页方向属性
   */
  private sanitize_opf(text: string): string {
    if (this.preserve_reading_layout) {
      return text;
    }
    return text.replace('page-progression-direction="rtl"', "");
  }

  /**
   * CSS 清洗在横排目标语言下移除竖排样式
   */
  private sanitize_css(text: string): string {
    if (this.preserve_reading_layout) {
      return text;
    }
    return text.replace(CSS_VERTICAL_WRITING_PATTERN, "");
  }

  /**
   * 整文档序列化按 EPUB 内路径和根节点判断 XML/HTML 模式，避免 XHTML 默认命名空间误走 HTML 输出
   */
  private serialize_doc(name: string, root: Element): string {
    const syntax = this.resolve_doc_syntax(name, root);
    const rendered =
      syntax === "xml"
        ? this.render_readable_xml_doc(root)
        : render(root, {
            decodeEntities: true,
            emptyAttrs: false,
            encodeEntities: "utf8",
            selfClosingTags: true,
            xmlMode: false,
          });
    return syntax === "html" ? rendered : `<?xml version="1.0" encoding="utf-8"?>\n${rendered}`;
  }

  /**
   * EPUB 内 XML 扩展名和 XHTML 命名空间都按 XML 输出，普通 HTML 保持 HTML 输出
   */
  private resolve_doc_syntax(name: string, root: Element): EpubDocumentSyntax {
    const lower_name = name.toLowerCase();
    if (
      lower_name.endsWith(".opf") ||
      lower_name.endsWith(".ncx") ||
      lower_name.endsWith(".xhtml") ||
      lower_name.endsWith(".xhtm")
    ) {
      return "xml";
    }
    if (root.attribs["xmlns"] === "http://www.w3.org/1999/xhtml") {
      return "xml";
    }
    if (root.name.includes(":") || (root.name.startsWith("{") && root.name.includes("}"))) {
      return "xml";
    }
    return "html";
  }

  /**
   * XML 模式先按节点语义转义再关闭 serializer 实体编码，避免命名实体和 NBSP 被二次改写。
   */
  private render_readable_xml_doc(root: Element): string {
    const restores: Array<() => void> = [];
    this.escape_xml_node(root, restores);
    try {
      return render(root, {
        decodeEntities: true,
        emptyAttrs: true,
        encodeEntities: false,
        selfClosingTags: true,
        xmlMode: true,
      });
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  }

  /**
   * 递归暂存并转义文本与属性，序列化结束后恢复原 DOM 供同一 EPUB 的其它写回分支复用。
   */
  private escape_xml_node(node: ChildNode, restores: Array<() => void>): void {
    if (node instanceof Text) {
      const original = node.data;
      const escaped = this.escape_xml_text(original);
      if (escaped !== original) {
        node.data = escaped;
        restores.push(() => {
          node.data = original;
        });
      }
      return;
    }
    if (!(node instanceof Element)) {
      return;
    }
    for (const [key, original] of Object.entries(node.attribs)) {
      const escaped = this.escape_xml_attribute(String(original));
      if (escaped !== original) {
        node.attribs[key] = escaped;
        restores.push(() => {
          node.attribs[key] = original;
        });
      }
    }
    for (const child of node.children) {
      this.escape_xml_node(child, restores);
    }
  }

  /**
   * XML 文本节点转义保留字符，并把 HTML 可读但 XML 未声明的 NBSP 写成数值实体。
   */
  private escape_xml_text(text: string): string {
    return text.replace(/[&<>\u00a0]/gu, (char) => {
      if (char === "&") {
        return "&amp;";
      }
      if (char === "<") {
        return "&lt;";
      }
      if (char === ">") {
        return "&gt;";
      }
      return "&#xa0;";
    });
  }

  /**
   * XML 属性额外转义双引号；大于号在属性中无需处理。
   */
  private escape_xml_attribute(value: string): string {
    return value.replace(/[&"<\u00a0]/gu, (char) => {
      if (char === "&") {
        return "&amp;";
      }
      if (char === '"') {
        return "&quot;";
      }
      if (char === "<") {
        return "&lt;";
      }
      return "&#xa0;";
    });
  }

  /**
   * EPUB 输出沿用 STORE 压缩，避免重压缩带来不必要的二进制差异
   */
  private async write_zip_file(zip_file: ZipContents, out_path: string): Promise<void> {
    const content = await write_zip(zip_file);
    await write_binary_file(out_path, content);
  }
}
