import { ChevronRight } from "lucide-react";

import { useAppNavigation } from "@/app/navigation/navigation-context";
import type { ScreenComponentProps } from "@/app/navigation/types";
import type { RouteId } from "@/app/navigation/types";
import { render_rich_text, type LocaleKey, type RichTextComponentMap } from "@/i18n";
import { useI18n } from "@/i18n";
import "@/pages/toolbox-page/toolbox-page.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/card";
import { Separator } from "@/shadcn/separator";

type ToolboxEntry = {
  id: string;
  title_key: LocaleKey;
  description_key: LocaleKey;
  route_id?: RouteId;
};

const TOOLBOX_ENTRIES: readonly ToolboxEntry[] = [
  {
    id: "name-field-extraction",
    title_key: "toolbox_page.entries.name_field_extraction.title",
    description_key: "toolbox_page.entries.name_field_extraction.description",
    route_id: "name-field-extraction",
  },
  {
    id: "ts-conversion",
    title_key: "toolbox_page.entries.ts_conversion.title",
    description_key: "toolbox_page.entries.ts_conversion.description",
    route_id: "ts-conversion",
  },
];

const DESCRIPTION_COMPONENT_MAP: RichTextComponentMap = {
  emphasis: (children) => {
    return <span className="toolbox-page__description-emphasis font-medium">{children}</span>;
  },
};

export function ToolboxPage(props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const { navigate_to_route } = useAppNavigation();

  return (
    <div
      className="toolbox-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      <section className="toolbox-page__grid" aria-label={t("toolbox_page.title")}>
        {TOOLBOX_ENTRIES.map((entry) => (
          <Card
            key={entry.id}
            className="toolbox-page__card"
            data-clickable={entry.route_id === undefined ? undefined : "true"}
            onClick={() => {
              if (entry.route_id !== undefined) {
                navigate_to_route(entry.route_id);
              }
            }}
          >
            <CardHeader className="toolbox-page__card-header">
              <CardTitle className="toolbox-page__card-title">{t(entry.title_key)}</CardTitle>
              <ChevronRight className="toolbox-page__card-icon" aria-hidden="true" />
            </CardHeader>
            <Separator className="toolbox-page__separator" />
            <CardContent className="toolbox-page__card-content">
              <p className="toolbox-page__description">
                {render_rich_text(t(entry.description_key), DESCRIPTION_COMPONENT_MAP)}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
