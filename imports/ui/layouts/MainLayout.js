import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { ThemeSelector } from '../components/ThemeSelector.js';

export const MainLayout = {
  view(vnode) {
    const user = Meteor.user();
    const isLoggingIn = Meteor.loggingIn();
    const hubUrl = Meteor.settings.public?.hubUrl || '#';
    const currentRoute = m.route.get();
    
    const navLinks = user ? [
      { path: '/', label: 'Home' },
      { path: '/collection', label: 'Collection' },
      { path: '/browse', label: 'Browse' },
      { path: '/statistics', label: 'Statistics' },
      { path: '/import', label: 'Import' }
    ] : [];
    
    return m('div.main-layout', [
      m('header.container', [
        m('nav', [
          m('ul', [
            m('li', [
              m('a.brand', { href: '/', oncreate: m.route.link }, [
                m('strong', Meteor.settings.public?.appName || 'Backlog Beacon')
              ])
            ])
          ]),
          m('ul', [
            ...navLinks.map(link => 
              m('li', { key: link.path }, [
                m('a', { 
                  href: link.path, 
                  oncreate: m.route.link,
                  class: currentRoute === link.path ? 'active' : ''
                }, link.label)
              ])
            )
          ]),
          m('ul', [
            m('li', m(ThemeSelector)),
            isLoggingIn ?
              m('li', m('span', 'Loading...')) :
            user ? [
              m('li', m('span.username', user.username || 'User')),
              m('li', m('a', { href: hubUrl }, 'Hub')),
              m('li', m('a.logout', {
                href: '#',
                onclick(event) {
                  event.preventDefault();
                  Meteor.logout(() => {
                    m.route.set('/not-logged-in');
                  });
                }
              }, 'Logout'))
            ] : [
              m('li', m('a', { href: hubUrl }, 'Login via Hub'))
            ]
          ])
        ])
      ]),
      
      m('main.container', vnode.children),
      
      m('footer.container', [
        m('small', [
          '© ', new Date().getFullYear(), ' Kokokino • ',
          m('a', { href: hubUrl }, 'Hub'),
          ' • ',
          m('a', { href: 'https://github.com/kokokino/backlog_beacon', target: '_blank', rel: 'noopener' }, 'GitHub'), 
          ' • Game data powered by ',
          m('a', { href: 'https://www.igdb.com', target: '_blank', rel: 'noopener' }, 'IGDB.com')
        ])
      ])
    ]);
  }
};
