import { describe, expect, it } from 'vitest'

import { buildWorkbenchView } from '@/app/project-runtime/selectors'

describe('buildWorkbenchView', () => {
  it('直接从 items/files 生成工作台条目', () => {
    const view = buildWorkbenchView({
      files: {
        'chapter01.txt': {
          rel_path: 'chapter01.txt',
          file_type: 'TXT',
        },
      },
      items: {
        '1': {
          item_id: 1,
          file_path: 'chapter01.txt',
          status: 'DONE',
        },
      },
    })

    expect(view.entries[0]?.rel_path).toBe('chapter01.txt')
    expect(view.summary.translated).toBe(1)
  })
})
