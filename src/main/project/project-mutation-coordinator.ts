import type { ApiJsonValue } from "../api/api-types";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import type { ProjectChangePublisher } from "./project-change-publisher";
import { get_runtime_section_revision, type ProjectDataSection } from "./project-section-revision";
import type {
  ProjectChangeEvent,
  ProjectChangeFilesPayload,
  ProjectChangeItemsPayload,
  ProjectChangePayloadMode,
  ProjectMutationResult,
} from "../../shared/project/event";
import * as AppErrors from "../../shared/error";

type JsonRecord = Record<string, ApiJsonValue>;

type RevisionBackedSection = "files" | "items" | "analysis" | "proofreading";

export type ProjectMutationRevisionContext = {
  project_path: string; // revision guard 与 revision writer 必须使用同一个工程身份
  meta: JsonRecord; // meta 是本次乐观锁校验和 revision bump 的共同快照
  sections: ProjectDataSection[]; // sections 是本次乐观锁声明读取或更新的项目数据域
};

export type ProjectMutationChangeRequest = {
  projectPath: string; // projectPath 已由会话或显式路径校验，publisher 不再猜测目标工程
  source: string; // source 是 HTTP mutation 与 SSE 事件共用的行为标签
  updatedSections: ProjectDataSection[]; // updatedSections 决定前端更新哪些 ProjectStore section
  items?: Pick<ProjectChangeItemsPayload, "payloadMode" | "changedIds" | "deleteIds">;
  files?: Pick<ProjectChangeFilesPayload, "payloadMode" | "changedPaths" | "deletePaths">;
  sectionModes?: Partial<Record<ProjectDataSection, ProjectChangePayloadMode>>;
};

export type ProjectMutationCommitRequest = {
  projectPath: string; // projectPath 是本次 revision guard、事务写入和事件发布的共同工程身份
  expectedSectionRevisions: ApiJsonValue | undefined; // expectedSectionRevisions 保留 API 原始锁值，在提交点统一收窄
  sections: ProjectDataSection[]; // sections 是提交阶段必须重新校验的依赖数据域
  buildOperations: (context: ProjectMutationRevisionContext) => DatabaseOperation[]; // buildOperations 必须同步读取最新事实并构造事务
  change: Omit<ProjectMutationChangeRequest, "projectPath">; // change 只声明发布草稿，工程路径由协调器补齐
};

/**
 * 统一协调同步项目 mutation 的 revision guard、revision writer 和 canonical 事件草稿
 */
export class ProjectMutationCoordinator {
  private readonly database: ProjectDatabase; // database workflow 是 revision meta 的唯一读取与写入入口

  private readonly project_change_publisher: ProjectChangePublisher | null; // publisher 是写库成功后进入 project.data_changed 的唯一出口

  /**
   * 注入数据库和可选发布器，保持纯测试场景能只验证写库结果
   */
  public constructor(
    database: ProjectDatabase,
    project_change_publisher: ProjectChangePublisher | null,
  ) {
    this.database = database;
    this.project_change_publisher = project_change_publisher;
  }

  /**
   * 按 section 校验乐观锁并返回同一 meta 快照，后续 revision bump 不再二次猜测基线
   */
  public assert_expected_section_revisions(
    project_path: string,
    expected_section_revisions: ApiJsonValue | undefined,
    sections: ProjectDataSection[],
  ): ProjectMutationRevisionContext {
    const expected = normalize_project_expected_section_revisions(expected_section_revisions);
    if (expected === null) {
      throw new AppErrors.RequestValidationError();
    }
    const meta = this.read_project_meta(project_path);
    for (const section of sections) {
      if (!Object.prototype.hasOwnProperty.call(expected, section)) {
        throw new AppErrors.RequestValidationError({
          public_details: { section },
        });
      }
      const current_revision = get_runtime_section_revision(meta, section);
      const expected_revision = expected[section] ?? 0;
      if (current_revision !== expected_revision) {
        throw new AppErrors.RevisionConflictError({
          public_details: {
            current_revision,
            expected_revision,
            section,
          },
        });
      }
    }
    return {
      project_path,
      meta,
      sections: [...sections],
    };
  }

  /**
   * 基于 revision guard 快照生成 bump 操作，确保事务内每个 section 只推进一次
   */
  public build_section_revision_operations(
    context: ProjectMutationRevisionContext,
    sections = filter_revision_backed_sections(context.sections),
  ): DatabaseOperation[] {
    return sections.map((section) =>
      this.op("setMeta", {
        projectPath: context.project_path,
        key: resolve_revision_meta_key(section),
        value: get_runtime_section_revision(context.meta, section) + 1,
      }),
    );
  }

  /**
   * 在最终提交点连续完成 revision guard、事务构造、写库和 canonical 事件发布
   */
  public commit_project_mutation(request: ProjectMutationCommitRequest): ProjectMutationResult {
    const revision_context = this.assert_expected_section_revisions(
      request.projectPath,
      request.expectedSectionRevisions,
      request.sections,
    );
    const operations = request.buildOperations(revision_context);
    this.database.execute_transaction(operations);
    return this.publish_project_data_change({
      projectPath: request.projectPath,
      ...request.change,
    });
  }

  /**
   * 无项目数据变化时仍返回统一 mutation result，调用方不再保留旧响应分支
   */
  public empty_project_mutation_result(): ProjectMutationResult {
    return { accepted: true, changes: [] };
  }

  /**
   * 数据库提交成功后只发布 canonical 变更草稿，HTTP 返回和 SSE 广播共用同一事件
   */
  public publish_project_data_change(request: ProjectMutationChangeRequest): ProjectMutationResult {
    if (this.project_change_publisher === null || request.updatedSections.length === 0) {
      return this.empty_project_mutation_result();
    }

    const change_event: ProjectChangeEvent | null =
      this.project_change_publisher.publish_project_change({
        targetProjectPath: request.projectPath,
        source: request.source,
        updatedSections: request.updatedSections as unknown as ApiJsonValue,
        ...this.build_row_payloads(request),
        ...this.build_section_payloads(request),
      });
    if (change_event === null || change_event === undefined) {
      return this.empty_project_mutation_result();
    }
    return { accepted: true, changes: [change_event] };
  }

  /**
   * 读取完整 meta，revision guard 和质量服务都复用同一读取口径
   */
  public read_project_meta(project_path: string): JsonRecord {
    return this.normalize_object(
      this.database.execute(this.op("getAllMeta", { projectPath: project_path })),
    );
  }

  /**
   * 行级 payload 只表达调用方明确声明的 delta，完整 section 交给 sections canonical data
   */
  private build_row_payloads(request: ProjectMutationChangeRequest): {
    items?: ApiJsonValue;
    files?: ApiJsonValue;
  } {
    return {
      ...(request.items === undefined ? {} : { items: request.items as unknown as ApiJsonValue }),
      ...(request.files === undefined ? {} : { files: request.files as unknown as ApiJsonValue }),
    };
  }

  /**
   * 未提供行级 delta 的 updated section 默认发布 canonical 完整 section data
   */
  private build_section_payloads(request: ProjectMutationChangeRequest): {
    sections?: ApiJsonValue;
  } {
    const sections = Object.fromEntries(
      request.updatedSections
        .filter((section) => !(section === "items" && request.items !== undefined))
        .filter((section) => !(section === "files" && request.files !== undefined))
        .map((section) => [
          section,
          { payloadMode: request.sectionModes?.[section] ?? "canonical-delta" },
        ]),
    ) as Partial<Record<ProjectDataSection, { payloadMode: ProjectChangePayloadMode }>>;
    return Object.keys(sections).length === 0
      ? {}
      : { sections: sections as unknown as ApiJsonValue };
  }

  /**
   * 把未知 JSON 收窄为对象，避免 meta 读取调用点扩散类型判断
   */
  private normalize_object(value: ApiJsonValue | undefined): JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
  }

  /**
   * 创建 database workflow 操作对象，避免协调器外部拼接协议壳
   */
  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }
}

/**
 * expected_section_revisions 只接受 JSON number 整数，拒绝字符串、布尔值、小数和负数锁值
 */
export function normalize_project_expected_section_revisions(
  value: ApiJsonValue | undefined,
): Record<string, number> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const expected: Record<string, number> = {};
  for (const [section, revision] of Object.entries(value)) {
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "invalid_expected_section_revision", section },
      });
    }
    expected[section] = revision;
  }
  return expected;
}

/**
 * 运行态 section 到 meta key 的唯一映射，避免各服务各自拼 revision key
 */
function resolve_revision_meta_key(section: RevisionBackedSection): string {
  if (section === "proofreading") {
    return "proofreading_revision.proofreading";
  }
  return `project_runtime_revision.${section}`;
}

/**
 * 只有带独立运行态 meta key 的 section 才能由通用 writer 自动 bump
 */
function filter_revision_backed_sections(sections: ProjectDataSection[]): RevisionBackedSection[] {
  return sections.filter(
    (section): section is RevisionBackedSection =>
      section === "files" ||
      section === "items" ||
      section === "analysis" ||
      section === "proofreading",
  );
}
