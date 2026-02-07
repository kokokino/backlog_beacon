import m from 'mithril';

export const ImportProgress = {
  view(vnode) {
    const { progress, importing, showCheckmark = false } = vnode.attrs;
    const isProcessing = progress && progress.status === 'processing';

    if (!(importing || isProcessing) || !progress) {
      return null;
    }

    return m('div.import-progress', [
      m('h3', 'Import Progress'),
      m('div.progress-info', [
        m('p', [
          m('strong', 'Processing: '),
          `${progress.current || 0} of ${progress.total || 0} games`
        ]),
        progress.currentGame && m('p', [
          m('strong', 'Current: '),
          progress.currentGame
        ]),
        m('div.progress-stats', [
          m('span.stat-imported', `${showCheckmark ? '✓ ' : ''}Imported: ${progress.imported || 0}`),
          m('span.stat-updated', ` | Updated: ${progress.updated || 0}`),
          m('span.stat-skipped', ` | Skipped: ${progress.skipped || 0}`)
        ])
      ]),
      m('progress', {
        value: progress.current || 0,
        max: progress.total || 100
      })
    ]);
  }
};
