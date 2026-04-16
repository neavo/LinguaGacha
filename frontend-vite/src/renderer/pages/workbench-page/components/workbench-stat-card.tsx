import { Card, CardContent, CardHeader, CardTitle } from '@/shadcn/card'
import { cn } from '@/lib/utils'

type WorkbenchStatCardProps = {
  title: string
  value: number
  unit: string
  accent?: 'success' | 'warning' | 'failure'
}

export function WorkbenchStatCard(props: WorkbenchStatCardProps): JSX.Element {
  return (
    <Card className="workbench-page__stat-card">
      <CardHeader className="workbench-page__stat-card-header">
        <CardTitle className="workbench-page__stat-card-title">{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="workbench-page__stat-card-content">
        <div className="workbench-page__stat-card-metric">
          <p
            className={cn(
              'workbench-page__stat-card-value',
              props.accent === 'success' && 'workbench-page__stat-card-value--success',
              props.accent === 'warning' && 'workbench-page__stat-card-value--warning',
              props.accent === 'failure' && 'workbench-page__stat-card-value--failure',
            )}
          >
            {props.value.toLocaleString()}
          </p>
          <span className="workbench-page__stat-card-unit">{props.unit}</span>
        </div>
      </CardContent>
    </Card>
  )
}

