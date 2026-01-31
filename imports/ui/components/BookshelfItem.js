import m from 'mithril';

// SVG placeholder for games without covers
const noCoverSvg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgiIGhlaWdodD0iMTQ5IiB2aWV3Qm94PSIwIDAgMTA4IDE0OSI+CiAgPHJlY3Qgd2lkdGg9IjEwOCIgaGVpZ2h0PSIxNDkiIGZpbGw9IiM0NDQiLz4KICA8dGV4dCB4PSI1NCIgeT0iNzQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM4ODgiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMiI+Tm8gQ292ZXI8L3RleHQ+Cjwvc3ZnPg==';

// Helper to get all available cover sources for a game
function getGameCoverSources(game) {
  if (!game) {
    return { localCoverUrl: null, igdbCoverUrl: null };
  }

  const localCoverUrl = game.localCoverUrl || null;

  let igdbCoverUrl = null;
  if (game.coverImageId) {
    igdbCoverUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.coverImageId}.jpg`;
  } else if (game.igdbCoverUrl) {
    igdbCoverUrl = game.igdbCoverUrl;
  } else if (game.coverUrl) {
    igdbCoverUrl = game.coverUrl;
  }

  return { localCoverUrl, igdbCoverUrl };
}

export const BookshelfItem = {
  view(vnode) {
    const { game, collectionItem, onUpdateItem } = vnode.attrs;

    if (!game && !collectionItem) {
      return null;
    }

    const displayName = game ? (game.title || game.name) : (collectionItem?.gameName || 'Unknown Game');
    const coverSources = getGameCoverSources(game);
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
