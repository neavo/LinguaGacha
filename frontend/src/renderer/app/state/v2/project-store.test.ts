import { describe, expect, it } from 'vitest'

import { createProjectStore } from './project-store'

describe('createProjectStore', () => {
  it('按 section 独立写入 bootstrap 阶段数据', () => {
    const store = createProjectStore()

    store.applyBootstrapStage('project', {
      project: { path: 'E:/demo/demo.lg', loaded: true },
      revisions: { projectRevision: 1, sections: { project: 1 } },
    })
    store.applyBootstrapStage('items', {
      items: { total: 2 },
      revisions: { sections: { items: 3 } },
    })

    expect(store.getState().project.path).toBe('E:/demo/demo.lg')
    expect(store.getState().items.total).toBe(2)
    expect(store.getState().revisions.projectRevision).toBe(1)
    expect(store.getState().revisions.sections.items).toBe(3)
  })
})
