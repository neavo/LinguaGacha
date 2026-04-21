import { describe, expect, it } from 'vitest'

import { runProofreadingWorkerTask } from './proofreading-worker'

describe('runProofreadingWorkerTask', () => {
  it('识别术语未生效和相似度过高', async () => {
    const result = await runProofreadingWorkerTask({
      items: [
        {
          item_id: 1,
          src: '苹果很好吃',
          dst: '苹果很好吃',
          status: 'DONE',
          file_path: 'a.txt',
        },
      ],
      glossary: [
        {
          src: '苹果',
          dst: 'Apple',
        },
      ],
      config: {
        source_language: 'JA',
        check_similarity: true,
      },
    })

    expect(result.warningMap['1']).toContain('SIMILARITY')
    expect(result.warningMap['1']).toContain('GLOSSARY')
  })
})
