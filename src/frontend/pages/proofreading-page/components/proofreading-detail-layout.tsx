import type { ReactNode } from "react";
import { useI18n } from "@frontend/app/locale/locale-provider";

/** 校对详情共用文件条和双栏结构，编辑状态、状态区和操作由各自内容拥有者提供。 */
export function ProofreadingDetailLayout(props: {
  file_label: string;
  file_actions?: ReactNode;
  source: ReactNode;
  translation: ReactNode;
  children?: ReactNode;
  hidden?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="proofreading-page__dialog-form" hidden={props.hidden}>
      <section className="proofreading-page__dialog-file-card">
        <span className="proofreading-page__dialog-file-path" title={props.file_label}>
          {props.file_label}
        </span>
        {props.file_actions}
      </section>
      <section className="proofreading-page__dialog-content-block">
        <section className="proofreading-page__dialog-content-section">
          <span className="proofreading-page__dialog-content-title font-medium">
            {t("proofreading_page.fields.source")}
          </span>
          {props.source}
        </section>
        <section className="proofreading-page__dialog-content-section">
          <span className="proofreading-page__dialog-content-title font-medium">
            {t("proofreading_page.fields.translation")}
          </span>
          {props.translation}
        </section>
      </section>
      {props.children}
    </div>
  );
}
