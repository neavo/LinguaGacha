import { randomUUID } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { default_native_fs as fs } from "../../../native/native-fs";
import type { ImagePreserveReason } from "../../../shared/image";
import type { ImageTextEnvironment } from "../../../shared/image-text";
import { image_sha256 } from "../../file/image/image-format";
import {
  locked,
  load_draft,
  file_sha256,
  file_exists,
  read_json,
  write_json,
  commit_directory,
} from "./state";
import { build_clean_manifest } from "./artifacts";
import { read_image_text_render } from "./render";
import { plan_member } from "./plan";

export type ImageTextDecision = { pageId: string } & (
  | { decision: "accept" }
  | { decision: "reject"; reason: string }
);
export type ImageDeliverySource =
  | { kind: "clean" }
  | { kind: "rendered"; renderId: string; decisions: readonly ImageTextDecision[] };
export type DeliveryPage = {
  pageId: string;
  originalSha256: string;
  inputSha256: string;
  status: "clean" | "accepted" | "incomplete";
  file?: string;
  sha256?: string;
  review?: "accept" | "reject" | "not_reviewed";
  reason?: string;
  preserved: { regionId: string; reason: ImagePreserveReason }[];
};
export type DeliveryManifest = {
  bookId: string;
  status: "complete" | "partial";
  deliverySha256: string;
  source: ImageDeliverySource;
  environment?: ImageTextEnvironment;
  pages: DeliveryPage[];
  files: { file: string; sha256: string }[];
};

/** 一处拥有完整及部分交付的原子发布与幂等完整性检查。 */
export async function publish(options: {
  workDirectory: string;
  outputDirectory: string;
  expectedRevision?: number;
  source: ImageDeliverySource;
}): Promise<DeliveryManifest & { path: string }> {
  const directory = path.resolve(options.workDirectory),
    parent = path.resolve(options.outputDirectory);
  if (directory === parent)
    throw new Error("Image delivery directory must differ from working directory");
  if (!options.source || !["clean", "rendered"].includes(options.source.kind))
    throw new Error("Explicit image delivery source is required");
  return locked(directory, () =>
    locked(parent, async () => {
      const draft = load_draft(directory);
      if (!draft.confirmed) throw new Error("Confirm image book before publishing");
      if (options.expectedRevision !== undefined && draft.revision !== options.expectedRevision)
        throw new Error("Stale image draft revision; call read() and reconsider the operation");
      const { clean, sources } = await build_clean_manifest(directory, draft);
      const rendered =
        options.source.kind === "rendered"
          ? await read_image_text_render(directory, draft, options.source.renderId, clean)
          : null;
      const decisions = new Map<string, ImageTextDecision>();
      if (options.source.kind === "rendered") {
        for (const decision of options.source.decisions) {
          const page = rendered!.run.pages.find((page) => page.pageId === decision.pageId);
          if (!page || decisions.has(decision.pageId))
            throw new Error("Invalid or duplicate text page decision");
          if (decision.decision !== "accept" && decision.decision !== "reject")
            throw new Error("Invalid text page decision");
          if (decision.decision === "accept" && page.status !== "ready")
            throw new Error("Only ready text pages can be accepted");
          if (decision.decision === "reject" && !decision.reason?.trim())
            throw new Error("Rejected text page requires a reason");
          decisions.set(
            decision.pageId,
            decision.decision === "accept"
              ? { pageId: decision.pageId, decision: "accept" }
              : { pageId: decision.pageId, decision: "reject", reason: decision.reason },
          );
        }
      }
      const artifacts: { file: string; sha256: string; source?: string; bytes?: string }[] = [];
      // 底图和运行读取入口已核验源文件；发布复用这份摘要。
      const addFile = (file: string, source: string, sha256: string) => {
        artifacts.push({ file, source, sha256 });
      };
      const addJson = (file: string, value: unknown) => {
        const bytes = JSON.stringify(value, null, 2);
        artifacts.push({ file, bytes, sha256: image_sha256(bytes) });
      };
      if (rendered) {
        addJson("input.json", rendered.input);
        addJson("render.json", rendered.run);
        addJson("selected.json", rendered.selected);
        const masks = new Map<string, string>();
        for (const page of rendered.selected)
          for (const region of page)
            for (const block of region.blocks)
              masks.set(block.selection.path, block.selection.sha256);
        for (const [member, sha256] of masks)
          addFile("masks/" + member, path.join(rendered.runDirectory, "masks", member), sha256);
      }
      const pages: DeliveryPage[] = [];
      for (const [index, page] of draft.book.pages.entries()) {
        const cleanPage = clean.pages[index]!;
        const preserved = cleanPage.regions
          .filter((region) => region.disposition === "preserve")
          .map((region) => ({ regionId: region.regionId, reason: region.preserveReason! }));
        const name = String(index + 1).padStart(4, "0") + "-" + page.pageId;
        const cleanSource = sources[cleanPage.clean]!;
        if (!rendered) {
          const file = name + ".png";
          addFile(file, cleanSource, cleanPage.cleanSha256);
          pages.push({
            pageId: page.pageId,
            originalSha256: page.sha256,
            inputSha256: cleanPage.inputSha256,
            status: "clean",
            file,
            sha256: cleanPage.cleanSha256,
            preserved,
          });
          continue;
        }
        const result = rendered.run.pages[index]!;
        const decision = decisions.get(page.pageId);
        // 零待译页仍经过 build_clean_manifest 的第一阶段验收校验。
        const inherited = !page.regions.some((region) => region.disposition === "translate");
        const accepted =
          result.status === "ready" &&
          (decision?.decision === "accept" || (!decision && inherited));
        const review = accepted
          ? ("accept" as const)
          : (decision?.decision ?? ("not_reviewed" as const));
        const common = {
          pageId: page.pageId,
          originalSha256: page.sha256,
          inputSha256: result.inputSha256,
          review,
          preserved,
          ...(decision?.decision === "reject" ? { reason: decision.reason } : {}),
        };
        if (accepted) {
          const file = "pages/" + name + ".png";
          addFile(
            file,
            inherited ? cleanSource : plan_member(rendered!.runDirectory, result.preview!),
            inherited ? cleanPage.cleanSha256 : result.previewSha256!,
          );
          pages.push({ ...common, status: "accepted", file, sha256: artifacts.at(-1)!.sha256 });
        } else {
          const prefix = "incomplete/" + name + "/";
          addFile(prefix + "clean.png", cleanSource, cleanPage.cleanSha256);
          addJson(prefix + "result.json", {
            ...result,
            review,
            ...(decision?.decision === "reject" ? { reason: decision.reason } : {}),
          });
          if (result.preview)
            addFile(
              prefix + "preview.png",
              plan_member(rendered!.runDirectory, result.preview),
              result.previewSha256!,
            );
          pages.push({ ...common, status: "incomplete" });
        }
      }
      const source: ImageDeliverySource = rendered
        ? {
            kind: "rendered",
            renderId: rendered.run.renderId,
            decisions: draft.book.pages.flatMap((page) => {
              const decision = decisions.get(page.pageId);
              return decision ? [decision] : [];
            }),
          }
        : { kind: "clean" };
      const base = {
        bookId: draft.book.bookId,
        status:
          clean.status === "complete" && pages.every((page) => page.status !== "incomplete")
            ? ("complete" as const)
            : ("partial" as const),
        source,
        ...(rendered ? { environment: rendered.run.environment } : {}),
        pages,
        files: artifacts.map(({ file, sha256 }) => ({ file, sha256 })),
      };
      const deliverySha256 = image_sha256(JSON.stringify(base));
      const manifest: DeliveryManifest = { ...base, deliverySha256 };
      const target = path.join(parent, "image-" + deliverySha256);
      const deliveryFile = path.join(target, "delivery.json");
      if (file_exists(target)) {
        if (!file_exists(deliveryFile) || !isDeepStrictEqual(read_json(deliveryFile), manifest))
          throw new Error("Published delivery manifest corrupted");
        for (const file of artifacts) {
          const output = path.join(target, file.file);
          if (!file_exists(output) || (await file_sha256(output)) !== file.sha256)
            throw new Error("Published delivery artifact missing or corrupted: " + file.file);
        }
        return { path: target, ...manifest };
      }
      const temporary = path.join(parent, ".image-" + randomUUID());
      await fs.make_dir_exclusive(temporary);
      try {
        for (const file of artifacts) {
          const output = path.join(temporary, file.file);
          if (file.source) fs.copy_file(file.source, output);
          else fs.write_file_atomic(output, file.bytes!);
        }
        write_json(path.join(temporary, "delivery.json"), manifest);
        await commit_directory(temporary, target);
        return { path: target, ...manifest };
      } finally {
        await fs.remove_async(temporary, { recursive: true, force: true });
      }
    }),
  );
}
