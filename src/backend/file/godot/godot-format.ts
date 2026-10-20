import { godot_member_kind } from "./member";
import assert from "node:assert/strict";
import { create_item, type Item } from "../../../domain/item";
import { AppError } from "../../../shared/error";
import type { GameFormatAdapter } from "../shared/game/format";
import { read_godot_metadata, type GodotLocation } from "./item";
import { create_text_extractor } from "./extract";
import { patch_gdsc } from "./gdsc";
import { read_source, patch_source } from "./gdscript";
import { read_po, patch_po } from "./po";
import { patch_scene } from "./scene";
import { patch_resource, read_resource, resource_string } from "./resource";
import { all_values } from "./variant";
import { string, u32, type Edit } from "./binary";
import { check_locale_member, patch_translation, patch_translation_fallback } from "./translation";

type Change = { original: string; text: string };

/** 每次容器操作共用一次语言表计划，坏成员保留到成员边界报告告警。 */
export function create_godot_adapter(): GameFormatAdapter {
  return {
    file_type: "GODOT",
    internal_path: (item) => read_godot_metadata(item.extra_field).internal_file_path,
    async create_members(files) {
      const context = new Map<string, Buffer>(),
        failures = new Map<string, unknown>();
      for (const [name, member] of files) {
        try {
          const bytes = Buffer.from(await member.async("uint8array"));
          if (check_locale_member(name, bytes)) context.set(name, bytes);
        } catch (error) {
          failures.set(name, error);
        }
      }
      const extractor = create_text_extractor(context);
      return {
        async read_file(content, file) {
          if (failures.has(file)) throw failures.get(file);
          return {
            items: extractor.extract(file, Buffer.from(content)).map((entry, row) =>
              create_item({
                file_type: "GODOT",
                file_path: file,
                row,
                src: entry.original,
                status: entry.eligible ? "NONE" : "RULE_SKIPPED",
                extra_field: {
                  godot: {
                    internal_file_path: file,
                    usage: entry.eligible ? "text" : "code",
                    location: entry.location,
                  },
                },
              }),
            ),
            warnings: [],
          };
        },
        async render(content, file, items) {
          try {
            const bytes = Buffer.from(content);
            if (file === "project.binary" && !failures.has(file))
              return patch_translation_fallback(bytes, extractor.plan);
            return render_member(bytes, file, items);
          } catch (cause) {
            throw new AppError("file.invalid_structure", { cause, public_details: { file } });
          }
        },
      };
    },
  };
}

/** 写回只解释持久坐标，不重新执行可能已经调整的候选规则。 */
function render_member(bytes: Buffer, file: string, items: readonly Item[]): Buffer {
  const changes = new Map<string, { location: GodotLocation; change: Change }>();
  for (const item of items) {
    if (item.status !== "PROCESSED" || item.dst === item.src) continue;
    const metadata = read_godot_metadata(item.extra_field);
    assert.equal(metadata.internal_file_path, file, "Mismatched Godot member");
    assert(!item.dst.includes("\0"), "Godot translation contains NUL");
    const { location } = metadata;
    const key =
      location.kind === "scene"
        ? `${location.kind}:${location.node}:${location.property}`
        : location.kind === "gdsc"
          ? `${location.kind}:${location.token}`
          : location.kind === "resource"
            ? `${location.kind}:${location.offset}`
            : location.kind === "slot"
              ? `${location.kind}:${location.word}`
              : `${location.kind}:${location.start}`;
    assert(!changes.has(key), "Duplicate Godot location");
    changes.set(key, { location, change: { original: item.src, text: item.dst } });
  }
  if (!changes.size) return bytes;
  const gdsc = new Map<number, Change>(),
    source = new Map<number, Change>(),
    po = new Map<number, Change>(),
    scenes = new Map<string, Change>(),
    slots = new Map<number, Change>(),
    edits: Edit[] = [];
  const kind = godot_member_kind(file, bytes);
  const resource = kind === "resource" || kind === "translation" ? read_resource(bytes) : null;
  for (const { location, change } of changes.values()) {
    switch (location.kind) {
      case "gdsc":
        assert(kind === "gdsc");
        gdsc.set(location.token, change);
        break;
      case "gd": {
        assert(kind === "gd");
        const literal = read_source(bytes.toString("utf8")).find(
          (value) => value.start === location.start,
        );
        assert(literal?.end === location.end, "Stale Godot source span");
        source.set(location.start, change);
        break;
      }
      case "po": {
        assert(kind === "po");
        const field = read_po(bytes.toString("utf8")).find(
          (value) => value.start === location.start,
        );
        assert(field?.end === location.end, "Stale Godot PO span");
        po.set(location.start, change);
        break;
      }
      case "scene":
        assert(resource?.type === "PackedScene");
        scenes.set(`${location.node}:${location.property}`, change);
        break;
      case "slot":
        assert(resource?.type === "OptimizedTranslation");
        slots.set(location.word, change);
        break;
      case "resource": {
        assert(
          resource && resource.type !== "PackedScene" && resource.type !== "OptimizedTranslation",
        );
        const value = resource.properties
          .flatMap((property) => [...all_values(property.value)])
          .find((value) => value.start === location.offset);
        assert(
          value && (value.type === 5 || value.type === 44) && typeof value.value === "string",
          "Invalid Godot string offset",
        );
        assert.equal(value.value, change.original, "Stale Godot resource string");
        edits.push({
          start: value.start,
          end: value.end,
          bytes:
            value.encoding === "resource_string"
              ? string(change.text, true)
              : value.type === 44
                ? Buffer.concat([u32(44), string(change.text, true)])
                : resource_string(change.text),
        });
        break;
      }
    }
  }
  if (gdsc.size) return patch_gdsc(bytes, gdsc);
  if (source.size) return Buffer.from(patch_source(bytes.toString("utf8"), source));
  if (po.size) return Buffer.from(patch_po(bytes.toString("utf8"), po));
  if (scenes.size) return patch_scene(bytes, scenes);
  if (slots.size) return patch_translation(bytes, slots);
  return patch_resource(bytes, edits);
}
