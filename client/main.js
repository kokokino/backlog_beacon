import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import './main.html';

import '@picocss/pico/css/pico.min.css';

import { Games } from '../imports/lib/collections/games.js';
import { CollectionItems } from '../imports/lib/collections/collectionItems.js';

import { MainLayout } from '../imports/ui/layouts/MainLayout.js';
import { HomePage } from '../imports/ui/pages/HomePage.js';
import { CollectionPage } from '../imports/ui/pages/CollectionPage.js';
import { BrowsePage } from '../imports/ui/pages/BrowsePage.js';
import { StatisticsPage } from '../imports/ui/pages/StatisticsPage.js';
import { ImportPage } from '../imports/ui/pages/ImportPage.js';
import { NotLoggedIn } from '../imports/ui/pages/NotLoggedIn.js';
import { NoSubscription } from '../imports/ui/pages/NoSubscription.js';
import { SessionExpired } from '../imports/ui/pages/SessionExpired.js';
import { SsoCallback } from '../imports/ui/pages/SsoCallback.js';
import { initializeTheme } from '../imports/ui/components/ThemeSelector.js';

window.Games = Games;
window.CollectionItems = CollectionItems;

const MeteorWrapper = {
  oninit() {
    this.computation = null;
  },
  oncreate() {
    this.computation = Tracker.autorun(() => {
      Meteor.user();
      Meteor.userId();
      Meteor.loggingIn();
      m.redraw();
    });
  },
  onremove() {
    if (this.computation) {
      this.computation.stop();
    }
  },
  view(vnode) {
    return vnode.children;
  }
};

const Layout = {
  view(vnode) {
    return m(MeteorWrapper, m(MainLayout, vnode.attrs, vnode.children));
  }
};

function layoutRoute(component, attrs = {}) {
  return {
    render() {
      return m(Layout, attrs, m(component));
    }
  };
}

function initializeApp() {
  const root = document.getElementById('app');
  
  m.route.prefix = '';

  m.route(root, '/', {
    '/': layoutRoute(HomePage),
    '/collection': layoutRoute(CollectionPage),
    '/browse': layoutRoute(BrowsePage),
    '/statistics': layoutRoute(StatisticsPage),
    '/import': layoutRoute(ImportPage),
    '/not-logged-in': layoutRoute(NotLoggedIn),
    '/no-subscription': layoutRoute(NoSubscription),
    '/session-expired': layoutRoute(SessionExpired),
    '/sso': {
      render() {
        return m(SsoCallback);
      }
    }
  });
}

Meteor.startup(() => {
  initializeTheme();
  initializeApp();
});
