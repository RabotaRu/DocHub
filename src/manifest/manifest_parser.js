import requests from '../helpers/requests';
import gitlab from "../helpers/gitlab";
import jsonata from 'jsonata';
import property from './prototype'

let touchProjects = {};

const parser = {
    // Манифест перезагружен
    onReloaded: null,
    // Запущена перезагрузка манифеста
    onStartReload: null,
    // События по ошибкам (ошибки запросов)
    onError: null,
    // Счетчик запросов
    reqCounter : 0,
    incReqCounter() {
        this.reqCounter++;
        if (this.onStartReload && (this.reqCounter === 1))
            this.onStartReload(this);
    },
    decReqCounter() {
        this.reqCounter--;
        if(this.reqCounter === 0 && this.onReloaded) {
            this.expandPrototype();
            this.onReloaded(this);
        }
    },
    // Режимы манифестов
    MODE_AS_IS : 'as-is', // Как есть
    MODE_AS_WAS : 'as-was', // Как было
    MODE_TO_BE : 'to-be', // Как будет
    // Журнал объединений
    mergeMap: [],
    // Итоговый манифест
    manifest: null,
    // Возвращает тип значения
    fieldValueType(value) {
        const type = typeof value;
        if (type === "string") {
            // В значении JSONata запрос
            if (/(\s+|)\(((.*|\d|\D)+?)(\)(\s+|))$/.test(value)) 
                return "jsonata"
            else {
                const ext = value.split('.').pop();
                // В значении ссылка на файл
                if (["yaml", "json", "jsonata"].indexOf(ext) >= 0)
                    return "ref"
                else
                    // В значении ссылка на файл
                    return "id"
            }
        } else 
            return type;
    },
    // Реализует наследование
    expandPrototype() {
        property.expandAll(this.manifest[this.manifest.mode || this.MODE_AS_IS]);
    },
    // Преобразование относительных ссылок в прямые
    propResolver: {
        docs(item, baseURI) {
            ["source", "origin", "data"].forEach((field) => 
                item[field] 
                && (parser.fieldValueType(item[field]) === "ref") 
                && (item[field] = requests.makeURIByBaseURI(item[field], baseURI))
            )
        },
        datasets(item, baseURI) {
            this.docs(item, baseURI);
        }
    },
    //Регистрирует ошибку
    // e - объект ошибки
    // uri - источник ошибки
    registerError(e, uri) {
        const errorPath = `$errors/requests/${new Date().getTime()}`;
        this.pushToMergeMap(errorPath, null, uri);
        // eslint-disable-next-line no-console
        console.error(e, `Ошибка запроса [${errorPath}:${uri}]`, e);
        const payload = {
            uri,
            error: e
        };
        let errorType = (() => {
            switch (e.name) {
                case 'YAMLSyntaxError':
                case 'YAMLSemanticError':
                    payload.range = e.source.range;
                    return "syntax";
                default:
                    return 'net';
            }
        })();

        this.onError && this.onError(errorType, payload);
    },
    // Сохраняет в карте склеивания данные
    pushToMergeMap(path, source, location) {
        if (path && path.split('/').length > 3) return;
        const storePath = path || '/';
        const found = this.mergeMap.find((element) => {
            return ((element.path === storePath) && (element.location === location));
        });
        if (!found) {
            this.mergeMap.push({
                path: path || '/',
                location
            });
            if (typeof source === 'object') {
                for (const key in source) {
                    this.pushToMergeMap(`${path || ''}/${key}`, source[key], location);
                }
            }
        }
    },
    // Склеивание манифестов
    // destination - Объект с которым происходит объединение. Низкий приоритете.
    // source - Объект с которым происходит объединение. Высокий приоритете.
    // location - Размещение объекта source (источник изменений)
    // path - Путь к объекту
    merge(destination, source, location, path) {
        let result;
        if (destination === undefined) {
            result = JSON.parse(JSON.stringify(source));
            this.pushToMergeMap(path, result, location);
        } else if (Array.isArray(source)) {
            if (Array.isArray(destination)) {
                result = JSON.parse(JSON.stringify(destination)).concat(JSON.parse(JSON.stringify(source)));
            } else {
                result = JSON.parse(JSON.stringify(source));
            }
            this.pushToMergeMap(path, result, location);
        } else if (typeof source === 'object') {
            result = JSON.parse(JSON.stringify(destination));
            typeof result !== 'object' && (result = {});
            const pathStruct = path ? path.split('/') : [];
            const entity = pathStruct.pop();
            for (const id in source) {
                const keyPath = `${path || ''}/${id}`;
                if (result[id]) {
                    result[id] = this.merge(result[id], source[id], location, `${path || ''}/${id}`);
                } else {
                    result[id] = JSON.parse(JSON.stringify(source[id]));
                    this.pushToMergeMap(keyPath, result[id], location)
                }
                pathStruct.length == 1 && this.propResolver[entity] && this.propResolver[entity](result[id], location);
            }
        } else {
            result = JSON.parse(JSON.stringify(source));
            this.pushToMergeMap(path, result, location);
        }
        return result;
    },

    // Возвращает контекст свойства по заданному пути
    // path - пусть к свойству
    getManifestContext (path) {
        let node = this.manifest;
        const keys = path.split('/');
        for (let i = 0; i < keys.length - 1; i++) {
            const key = decodeURIComponent(keys[i]);
            node = node[key] || (node[key] = {});
        }
        const property = decodeURIComponent(keys.pop());
        return {
            node,
            property,
            data: node[property]
        }
    },

    // Декомпозирует свойство манифеста
    // Если свойство содержит ссылку, загружает объект
    // data - Значение свойства
    // path - пусть к свойству от корня манифеста
    expandProperty (data, path, baseURI) {
        // const data = this.getManifestContext(path).data;
        // Если значение является ссылкой, загружает объект по ссылке
        if (typeof data === 'string') {
            const URI = requests.makeURIByBaseURI(data, baseURI);
            this.incReqCounter();
            requests.request(URI).then((response) => {
                const context = this.getManifestContext(path);
                context.node[context.property] = this.merge(context.node[context.property], response.data, URI, path);
                this.touchProjects(URI);
            })
                .catch((e) => this.registerError(e, URI))
                .finally(() => this.decReqCounter())
        }
    },
    // Разбираем сущности
    // path - путь к перечислению сущностей (ключ -> объект)
    parseEntity(context, path, baseURI) {
        for (const key in context) {
            this.expandProperty(context[key], `${path}/${encodeURIComponent(key)}`, baseURI);
        }
    },

    // Детектит обращение к проектам
    touchProjects (location, callback) {
        const projectID = requests.getGitLabProjectID(location);
        let URI;
        if (projectID && !touchProjects[projectID]) {
            touchProjects[projectID] = {};
            URI = gitlab.projectLanguagesURI(projectID);
            this.incReqCounter();
            requests.request(URI).then((response) => {
                callback('project/languages', {
                    projectID: projectID,
                    content: typeof response.data === "string" ? JSON.parse(response.data) : response.data,
                });
            })
                // eslint-disable-next-line no-console
                .catch((e) => this.registerError(e, URI))
                .finally(() => this.decReqCounter())
        }
    },

    // Подключение манифеста
    import(uri, subimport) {
        if (!subimport) {
            this.manifest = {};
            this.mergeMap = [];
            touchProjects = {};
            this.incReqCounter();

            // Подключаем манифест самого DocHub
            // eslint-disable-next-line no-constant-condition
            if (
                (process.env.VUE_APP_DOCHUB_MODE !== "plugin") &&
                ((process.env.VUE_APP_DOCHUB_APPEND_DOCHUB_DOCS || 'y').toLowerCase() === 'y')
                ) {
                this.import(requests.makeURIByBaseURI('documentation/root.yaml', requests.getSourceRoot()), true);
            }
        }

        this.incReqCounter();
        this.touchProjects(uri, () => false);
        requests.request(uri).then((response) => {
            const manifest = typeof response.data === 'object' ? response.data : JSON.parse(response.data);
            if (!manifest) return;

            // Определяем режим манифеста
            // eslint-disable-next-line no-unused-vars
            const mode = manifest.mode || this.MODE_AS_IS;
            this.manifest[mode] = this.merge(this.manifest[mode], manifest, uri);

            for (const section in manifest) {
                ['forms', 'namespaces', 'aspects', 'docs', 'contexts', 'components', 'datasets'].indexOf(section) >= 0
                && section !== 'imports' 
                this.parseEntity(manifest[section],`${mode}/${section}`, uri);
            }

            // Подключаем манифесты
            (jsonata('imports').evaluate(response.data) || []).map((importUri) => {
                this.import(requests.makeURIByBaseURI(importUri, uri), true);
            });
        })
        // eslint-disable-next-line no-console
        .catch((e) => this.registerError(e, uri))
        .finally(() => {
            this.decReqCounter();
        });

        !subimport && this.decReqCounter();
    }
};

export default parser;