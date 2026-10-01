import path from "node:path";
import render from "dom-serializer";
import { DomUtils, parseDocument } from "htmlparser2";
import { Element, isTag, Text, type AnyNode } from "domhandler";

import { Item } from "../../../domain/item";
import { read_json_record, type JsonRecord } from "../../../domain/json";
import { AppError } from "../../../shared/error";
import { decode_text_content } from "../../../shared/utils/text-tool";
import { group_items, write_text_file, type ExportPaths } from "../file-format-shared";

type XliffLocation = {
  format: "XLIFF";
  unit_id: string;
  segment_index: number;
};

/** Read and write XLIFF 2.0 files by stable unit id and segment position. */
export class XLIFFFormat {
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    const text = await decode_text_content(content);
    const document = parseDocument(text, {
      xmlMode: true,
      lowerCaseTags: false,
      lowerCaseAttributeNames: false,
    });
    const version = this.read_xliff_version(document);
    if (version !== "2.0") return [];

    const items: Item[] = [];
    for (const unit of this.find_descendants(document, "unit")) {
      const unit_id = unit.attribs["id"]?.trim();
      if (unit_id === undefined || unit_id === "") continue;
      const segments = this.find_descendants(unit, "segment");
      for (const [segment_index, segment] of segments.entries()) {
        const source = this.first_descendant(segment, "source");
        if (source === null) continue;
        const target = this.first_descendant(segment, "target");
        const src = DomUtils.textContent(source);
        const dst = target === null ? "" : DomUtils.textContent(target);
        items.push(
          Item.from_json({
            src,
            dst,
            extra_field: {
              format: "XLIFF",
              unit_id,
              segment_index,
            } satisfies XliffLocation,
            row: items.length,
            file_type: "XLIFF",
            file_path: rel_path,
            status: dst !== "" && dst !== src ? "PROCESSED" : "NONE",
          }),
        );
      }
    }
    return items;
  }

  public async write_to_path(
    items: Item[],
    paths: ExportPaths,
    asset_reader: (rel_path: string) => Buffer | null,
  ): Promise<void> {
    for (const [rel_path, group] of group_items(items, "XLIFF")) {
      const original = asset_reader(rel_path);
      if (original === null) {
        throw new AppError("file.not_found", { public_details: { file: rel_path } });
      }
      const document = parseDocument(await decode_text_content(original), {
        xmlMode: true,
        lowerCaseTags: false,
        lowerCaseAttributeNames: false,
      });
      if (this.read_xliff_version(document) !== "2.0") {
        throw new AppError("file.invalid_structure", { public_details: { file: rel_path } });
      }
      const units = new Map<string, Element>();
      for (const unit of this.find_descendants(document, "unit")) {
        const unit_id = unit.attribs["id"]?.trim();
        if (unit_id !== undefined && unit_id !== "") units.set(unit_id, unit);
      }
      for (const item of group) {
        const location = this.read_location(item.extra_field);
        const unit = units.get(location.unit_id);
        if (unit === undefined) {
          throw new AppError("file.invalid_structure", {
            public_details: { file: rel_path, unit_id: location.unit_id },
          });
        }
        const segment = this.find_descendants(unit, "segment")[location.segment_index];
        const source = segment === undefined ? undefined : this.first_descendant(segment, "source");
        if (
          segment === undefined ||
          source === undefined ||
          source === null ||
          DomUtils.textContent(source) !== item.src
        ) {
          throw new AppError("file.invalid_structure", {
            public_details: { file: rel_path, unit_id: location.unit_id },
          });
        }
        let target = this.first_descendant(segment, "target");
        if (target === null) {
          target = new Element("target", {}, []);
          segment.children.push(target);
          target.parent = segment;
        }
        target.children = [new Text(item.effective_dst())];
        target.children[0]!.parent = target;
      }
      const rendered = render(document, {
        decodeEntities: true,
        encodeEntities: true,
        emptyAttrs: true,
        selfClosingTags: true,
        xmlMode: true,
      });
      const normalized = rendered.replace(/^<\?xml([^>]*)>\s*/u, "<?xml$1?>\n");
      await write_text_file(path.join(paths.translated_path, rel_path), normalized);
    }
  }

  private read_xliff_version(document: AnyNode): string {
    const root = document.type === "root" ? document.children.find(isTag) : undefined;
    return root?.name.toLowerCase() === "xliff" ? root.attribs["version"] ?? "" : "";
  }

  private read_location(value: unknown): XliffLocation {
    const record = read_json_record(value) as JsonRecord;
    const nested = read_json_record(record["xliff"]);
    const source = Object.keys(nested).length > 0 ? nested : record;
    const unit_id = String(source["unit_id"] ?? "").trim();
    const segment_index = Number(source["segment_index"] ?? -1);
    if (unit_id === "" || !Number.isInteger(segment_index) || segment_index < 0) {
      throw new AppError("file.invalid_structure", { public_details: { file: "XLIFF" } });
    }
    return { format: "XLIFF", unit_id, segment_index };
  }

  private find_descendants(node: AnyNode, name: string): Element[] {
    const result: Element[] = [];
    const visit = (current: AnyNode): void => {
      if (isTag(current)) {
        if (current.name.toLowerCase() === name.toLowerCase()) result.push(current);
        for (const child of current.children) visit(child);
      } else if (current.type === "root") {
        for (const child of current.children) visit(child);
      }
    };
    visit(node);
    return result;
  }

  private first_descendant(node: AnyNode, name: string): Element | null {
    return this.find_descendants(node, name)[0] ?? null;
  }
}
