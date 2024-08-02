import { Store } from 'vuex';
import YAML from 'yaml';
import { listeners } from './pipe';
import config from '@front/config';
import { Buffer } from 'buffer';
import router from '@front/router';
import { Route } from 'vue-router';

enum Files {
  'jpg',
  'jpeg',
  'png',
  'svg',
  'yaml',
  'json',
  'plantuml'
}

type TFiles = keyof typeof Files;

type TEvent = {
  data?: {
    command?: string,
    content?: {
      url?: string,
      uri?: string,
      stringifedUri?: string,
      type?: TFiles,
      uuid?: string,
      value?: string,
      node?: any,
      route: Route
    },
    error?: any
  }
}

const getContentType = (type: TFiles): string => {
  if (type === 'svg') {
    return 'image/svg+xml';
  }

  if (['jpg', 'jpeg', 'png'].includes(type)) {
    return `image/${type}`;
  }

  return '';
};

const normalizeResponse = (type: TFiles, content: string): any => {
  if (['jpg', 'jpeg', 'png', 'svg'].includes(type)) {
    return Buffer.from(content, 'base64');
  }

  if (type === 'yaml') {
    return YAML.parse(content);
  }

  if (type === 'json') {
    return JSON.parse(content);
  }

  if (type === 'plantuml') {
    return content;
  }

  return content;
};

export default (store: Store<any>): void => {
  window.addEventListener('message', (event: TEvent) => {
    const {command, content, error} = event?.data;

    if(command === 'fetchPlugins') {
      const plugins = require('../../../plugins.json');
      window.$PAPI.pluginList({ plugins: plugins.inbuilt });
    }

    if(command === 'goToRoute') {
      (window as any).Router.push(content.route);
    }
    if(command === 'refresh') {
      // Костыль. router.go(0) не работает
      router.go(-1);
      setTimeout(() => router.go(1), 1);
    }
    if(command === 'checkIsEntity') {
      if(store.state.manifest.entities[content.node.name])
        window.$PAPI.addLinks(content.node);
    }
    if (command === 'navigate') {
      (window as any).Router.push('/');
      (window as any).Router.push(content.url);
    }
    if(command === 'refresh') {
      // Костыль. router.go(0) не работает
      router.go(-1);
      setTimeout(() => router.go(1), 1);
    }

    if (command === 'response') {
      const {value, type, uuid} = content;

      if (error) {
        listeners[uuid].rej(error);
      }

      try {
        let data = normalizeResponse(type, value);

        const { resolver, args, res } = listeners[uuid]
        if (data.hasCache) {
          // Если кэш есть - отдаем его
          res(data.cache)
          return;
        } else if(!data.hasCache && listeners[uuid].resolver) {
          // Если нет - Получаем его из резолвера и аргументов
          const key = data.key
          resolver(...Object.entries(args)).then((data: any) => {
            // Вызываем updateCache и отдаем данные
            window.$PAPI.updateCache(key, data)
            res(data);
          });
          return;
        } else
        listeners[uuid].res({
          data,
          headers: {
            'content-type': getContentType(type)
          }
        });
      } catch (e) {
        listeners[uuid].rej(e);
      } finally {
        delete listeners[uuid];
      }
    }

    if (command === 'has-root-manifest') {
      const {uri} = content;

      if (uri === null) {
        window.DochubVsCodeExt.rootManifest = null;
        // config.root_manifest = null;
        store.commit('setNoInited', true);
      } else {
        window.DochubVsCodeExt.rootManifest = uri;
        // config.root_manifest = uri;
        store.dispatch('reloadAll');
      }
    }
  });
};
