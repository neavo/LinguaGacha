import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url))

function read_source(relative_path: string): string {
  return readFileSync(resolve(CURRENT_DIR, relative_path), 'utf8')
}

describe('runtime guard', () => {
  it('前端不再保留运行态开关和 runtime mode 空壳属性', () => {
    const desktop_runtime_source = read_source('../state/desktop-runtime-context.tsx')
    const workbench_page_source = read_source('../../pages/workbench-page/page.tsx')
    const workbench_state_source = read_source('../../pages/workbench-page/use-workbench-live-state.ts')
    const proofreading_page_source = read_source('../../pages/proofreading-page/page.tsx')
    const glossary_state_source = read_source('../../pages/glossary-page/use-glossary-page-state.ts')

    expect(desktop_runtime_source).not.toContain('isProjectRuntimeV2Enabled')
    expect(workbench_page_source).not.toContain('data-runtime-mode')
    expect(workbench_state_source).not.toContain('isProjectRuntimeV2Enabled')
    expect(proofreading_page_source).not.toContain('data-runtime-mode')
    expect(glossary_state_source).not.toContain('isProjectRuntimeV2Enabled')
  })

  it('桌面壳层不再监听 V1 事件流和旧 invalidation topic', () => {
    const source = read_source('../state/desktop-runtime-context.tsx')
    const legacy_stream_symbol = ['open', 'event', 'stream'].join('_')
    const legacy_proofreading_topic = ['proofreading', 'snapshot_invalidated'].join('.')
    const legacy_workbench_topic = ['workbench', 'snapshot_changed'].join('.')

    expect(source).not.toContain(legacy_stream_symbol)
    expect(source).not.toContain(legacy_proofreading_topic)
    expect(source).not.toContain(legacy_workbench_topic)
  })

  it('desktop api 不再暴露旧 SSE 入口', () => {
    const source = read_source('../desktop-api.ts')
    const legacy_path = ['/api', 'events', 'stream'].join('/')

    expect(source).not.toContain(legacy_path)
    expect(source).toContain('/api/v2/events/stream')
  })
})
