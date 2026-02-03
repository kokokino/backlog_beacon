import m from 'mithril';
import { getCoverSources, noCoverSvgSmall as noCoverSvg } from '../lib/coverUrls.js';

export const BookshelfItem = {
  view(vnode) {
    const { game, collectionItem, onUpdateItem } = vnode.attrs;

    if (!game && !collectionItem) {
      return null;
    }

    const displayName = game?.title || 'Unknown Game';
    const coverSources = getCoverSources(game);
    const { localCoverUrl, igdbCoverUrl } = coverSources;

    let initialCoverUrl;
    let initialSource;
    if (localCoverUrl) {
      initialCoverUrl = localCoverUrl;
      initialSource = 'local';
    } else if (igdbCoverUrl) {
      initialCoverUrl = igdbCoverUrl;
      initialSource = 'igdb';
    } else {
      initialCoverUrl = noCoverSvg;
      initialSource = 'placeholder';
    }

    return m('div.bookshelf-item', {
      onclick: () => {
        if (collectionItem && onUpdateItem) {
          onUpdateItem(collectionItem);
        }
      },
      title: displayName
    }, [
      m('img', {
        src: initialCoverUrl,
        alt: displayName,
        loading: 'lazy',
        'data-cover-source': initialSource,
        onerror(event) {
          const img = event.target;
          const currentSource = img.dataset.coverSource;

          if (currentSource === 'local' && igdbCoverUrl) {
            img.dataset.coverSource = 'igdb';
            img.src = igdbCoverUrl;
          } else {
            img.dataset.coverSource = 'placeholder';
            img.src = noCoverSvg;
          }
        }
      })
    ]);
  }
};
