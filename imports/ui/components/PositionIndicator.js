import m from 'mithril';

export const PositionIndicator = {
  view(vnode) {
    const { start, end, total } = vnode.attrs;
    // console.log('[PositionIndicator] Rendering:', { start, end, total, loading });

    if (total === 0) {
      return null;
    }

    return m('div.position-indicator',
      `${start.toLocaleString()}-${end.toLocaleString()} of ${total.toLocaleString()} games`
    );
  }
};
