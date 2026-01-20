import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { RequireAuth } from '../components/RequireAuth.js';
import { CollectionStats } from '../components/CollectionStats.js';

const HomeContent = {
  oninit(vnode) {
    this.seeding = false;
    this.seedResult = null;
  },
  
  view(vnode) {
    return m('div', [
      m('h1', 'Welcome to Backlog Beacon'),
      m('p', 'Track your video game collection, import from Darkadia, and browse your games on a beautiful 3D bookshelf.'),
      
      m('article', [
        m('header', m('h2', 'Your Collection Stats')),
        m(CollectionStats)
      ]),
      
      m('article', [
        m('header', m('h2', 'Quick Actions')),
        m('div.button-group', [
          m('a.button', { href: '/collection', oncreate: m.route.link }, 'View Collection'),
          m('a.button.outline', { href: '/browse', oncreate: m.route.link }, 'Browse Games'),
          m('a.button.outline', { href: '/import', oncreate: m.route.link }, 'Import Games')
        ])
      ]),
      
      m('footer', [
        m('small', [
          'Game data powered by ',
          m('a', { href: 'https://www.igdb.com', target: '_blank', rel: 'noopener' }, 'IGDB.com')
        ])
      ])
    ]);
  }
};

export const HomePage = {
  view() {
    return m(RequireAuth, m(HomeContent));
  }
};
