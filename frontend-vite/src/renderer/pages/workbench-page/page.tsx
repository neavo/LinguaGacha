import { PageScaffold } from '@/widgets/page-scaffold/PageScaffold'

import { workbench_page_mock } from '@/pages/workbench-page/mock'

type WorkbenchPageProps = {
  is_sidebar_collapsed: boolean
}

export function WorkbenchPage(props: WorkbenchPageProps): JSX.Element {
  return (
    <PageScaffold
      title_key="nav.item.workbench"
      summary_key="task.page.workbench.summary"
      mock={workbench_page_mock}
      is_sidebar_collapsed={props.is_sidebar_collapsed}
    />
  )
}
