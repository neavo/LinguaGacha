import { AppShell } from '@/app/shell/AppShell'
import { TooltipProvider } from '@/components/ui/tooltip'

function App(): JSX.Element {
  return (
    <TooltipProvider delayDuration={120}>
      <AppShell />
    </TooltipProvider>
  )
}

export default App
