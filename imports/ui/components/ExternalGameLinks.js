import m from 'mithril';

const EXTERNAL_SITES = [
  {
    id: 'igdb',
    name: 'IGDB',
    domain: 'igdb.com',
    getUrl: (game, encodedTitle) => {
      if (game?.slug) {
        return `https://www.igdb.com/games/${game.slug}`;
      }
      return `https://www.igdb.com/search?q=${encodedTitle}`;
    }
  },
  {
    id: 'hltb',
    name: 'HowLongToBeat',
    domain: 'howlongtobeat.com',
    getUrl: (game, encodedTitle) => `https://howlongtobeat.com/?q=${encodedTitle}`
  },
  {
    id: 'gamefaqs',
    name: 'GameFAQs',
    domain: 'gamefaqs.gamespot.com',
    getUrl: (game, encodedTitle) => `https://gamefaqs.gamespot.com/search?game=${encodedTitle}`
  },
  {
    id: 'metacritic',
    name: 'Metacritic',
    domain: 'metacritic.com',
    getUrl: (game, encodedTitle) => `https://www.google.com/search?q=site:metacritic.com+${encodedTitle}+game`
  },
  {
    id: 'youtube',
    name: 'YouTube',
    domain: 'youtube.com',
    getUrl: (game, encodedTitle) => `https://www.youtube.com/results?search_query=${encodedTitle}+gameplay`
  }
];

export const ExternalGameLinks = {
  view(vnode) {
    const { game } = vnode.attrs;
    const title = game?.title || game?.name || '';

    if (!title) {
      return null;
    }

    const encodedTitle = encodeURIComponent(title);

    return m('div.external-game-links',
      EXTERNAL_SITES.map(site =>
        m('a.external-link', {
          href: site.getUrl(game, encodedTitle, title),
          target: '_blank',
          rel: 'noopener',
          title: `Look up on ${site.name}`
        }, [
          m('img', {
            src: `https://www.google.com/s2/favicons?domain=${site.domain}&sz=16`,
            alt: site.name,
            width: 16,
            height: 16
          })
        ])
      )
    );
  }
};
