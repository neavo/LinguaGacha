import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/ui/card'
import { cn } from '@/lib/utils'

type WorkbenchStatCardProps = {
  title: string
  value: number
  unit: string
  accent?: 'success' | 'warning'
}

export function WorkbenchStatCard(props: WorkbenchStatCardProps): JSX.Element {
  return (
    <Card className="workbench-page__stat-card">
      <CardHeader>
        <CardTitle className="workbench-page__stat-card-title">{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-1.5">
        <p
          className={cn(
            'workbench-page__stat-card-value',
            props.accent === 'success' && 'workbench-page__stat-card-value--success',
            props.accent === 'warning' && 'workbench-page__stat-card-value--warning',
          )}
        >
          {props.value.toLocaleString()}
        </p>
      </CardContent>
      <CardFooter className="mt-auto">
        <span className="workbench-page__stat-card-unit">{props.unit}</span>
      </CardFooter>
    </Card>
  )
}
