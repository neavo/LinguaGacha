import type { MigrationDescriptor } from "../migration-types";

/** 旧译稿所有范围均为翻译；在首次打开事务中补齐判别字段，正文与来源保持原值。 */
export const pdf_section_kind_migration: MigrationDescriptor = {
  id: "pdf-section-kind",
  order: 460,
  run_project_database_writeback({ db }): void {
    db.exec(`UPDATE pdf_documents SET data = json_set(data, '$.translation.sections', (
      SELECT json_group_array(json(CASE WHEN json_type(s.value, '$.kind') IS NULL
        THEN json_set(s.value, '$.kind', 'translate') ELSE s.value END))
      FROM json_each(pdf_documents.data, '$.translation.sections') s
    )) WHERE EXISTS (
      SELECT 1 FROM json_each(pdf_documents.data, '$.translation.sections') s
      WHERE json_type(s.value, '$.kind') IS NULL
    )`);
  },
};
