import { PageScaffold } from '@/widgets/page-scaffold/page-scaffold'

import { model_page_mock } from '@/pages/model-page/mock'

type ModelPageProps = {
  is_sidebar_collapsed: boolean
}

export function ModelPage(props: ModelPageProps): JSX.Element {
  return (
    <PageScaffold
      title_key="nav.item.model"
      summary_key="common.project.model.summary"
      mock={model_page_mock}
      is_sidebar_collapsed={props.is_sidebar_collapsed}
    />
  )
}
