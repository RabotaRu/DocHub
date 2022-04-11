import config from '../../config'
import cookie from 'vue-cookie';
import GitHelper from '../helpers/gitlab'
import parser from '../manifest/manifest_parser';
import Vue from 'vue';
import query from "../manifest/query";
import manifest_parser from "../manifest/manifest_parser";
import requests from "../helpers/requests";
import gateway from '../idea/gateway';
import consts from '../consts';

const axios = require('axios');

export default {
    state: {
        // Признак загрузки данных
        isReloading: true,
        // Токен досутпа в GitLab
        access_token: null,
        // Обобщенный манифест
        manifest: {},
        // Выявленные Проблемы
        problems: [],
        // Источники данных манифеста
        sources: [],
        // Доступные проекты GitLab
        available_projects: {},
        // Проекты
        projects: {},
        diff_format: 'line-by-line',
        // Последние изменения
        last_changes: {},
        // Движок для рендеринга
        renderCore: 'graphviz',
        // Признак инциализации проекта в плагине
        notInited: null,
        // Признак критической проблемы
        criticalError: null
    },

    mutations: {
        clean(state) {
            state.manifest = {};
            state.problems = [];
            state.sources = {};
            state.available_projects = {};
            state.projects = {};
            state.last_changes = {};
            state.notInited = null;
            state.criticalError = null;
        },
        setManifest(state, value) {
            state.manifest = value;
        },
        setSources(state, value) {
            state.sources = value;
        },
        setIsReloading(state, value) {
            state.isReloading = value;
        },
        setAccessToken(state, value) {
            state.access_token = value;
            cookie.set('git_access_token', value, 1);
        },
        setDiffFormat(state, value) {
            state.diff_format = value;
            cookie.set('diff_format', value, 1);
        },
        appendLastChanges(state, value) {
            Vue.set(state.last_changes, value.id, value.payload);
        },
        appendProblems(state, value) {
            state.problems = query.expression("$distinct($)")
                .evaluate(JSON.parse(JSON.stringify((state.problems || []).concat(value)))) || [];
        },
        setRenderCore(state, value) {
            state.renderCore = value;
        },
        setNoInited(state, value) {
            state.notInited = value;
        },
        setCriticalError(state, value) {
            state.criticalError = value;
        }
    },

    actions: {
        // Action for init store
        init(context) {
            context.commit('setRenderCore', 
                process.env.VUE_APP_DOCHUB_MODE === "plugin" ? 'smetana' : 'graphviz'
            );
            const access_token = cookie.get('git_access_token');
            if (access_token) {
                context.commit('setAccessToken', access_token);
            }
            context.dispatch('reloadAll');
            let diff_format = cookie.get('diff_format');
            context.commit('setDiffFormat', diff_format ? diff_format : context.state.diff_format);
            parser.onReloaded = (parser) => {
                context.commit('setManifest', Object.freeze(parser.manifest));
                context.commit('setSources', Object.freeze(parser.mergeMap));
                context.commit('setIsReloading', false);
                context.commit('appendProblems', 
                    query.expression(query.problems())
                    .evaluate(parser.manifest[manifest_parser.MODE_AS_IS]) || []);
                if (!Object.keys(context.state.manifest || {}).length && (context.state.problems ||[]).length) {
                    context.commit('setCriticalError', true);
                }
            };
            parser.onStartReload = () => {
                context.commit('setNoInited', false);
                context.commit('setIsReloading', true);
            }
            parser.onError = (action, data) => {
                if (action === 'syntax') {
                    const problem = {
                        problem: "Ошибки синтаксиса",
                        route: (data.error.config || {url: data.uri}).url,
                        range: data.range
                    };
                    if (process.env.VUE_APP_DOCHUB_MODE === "plugin") {
                        problem.target = "plugin";
                        problem.title = `${data.uri.slice(19)} [${data.error}]`;
                    } else {
                        problem.target = "_blank";
                        problem.title = `${data.uri} [${data.error}]`;
                    }
                    context.commit('appendProblems', [problem]);

                } else if (data.uri === consts.plugin.ROOT_MANIFEST) {
                    context.commit('setNoInited', true);
                } else {
                    context.commit('appendProblems', [{
                        problem: "Сетевые ошибки",
                        route: (data.error.config || {url: data.uri}).url,
                        target: "_blank",
                        title: `${data.uri} [${data.error}]`
                    }]);
                }
            };

            let changes = {};
            let refreshTimer = null;
            gateway.appendListener('source/changed', (data) => {
                // eslint-disable-next-line no-console
                if (data) {
                    changes = Object.assign(changes, data);
                    if (refreshTimer) clearTimeout(refreshTimer);
                    refreshTimer = setInterval(() => {
                        for (const source in changes) {
                            if (context.state.sources.find((item) => {
                                return item.location === source;
                            })) {
                                // eslint-disable-next-line no-console
                                console.info('>>>>>> GO RELOAD <<<<<<<<<<');
                                changes = {};
                                context.dispatch('reloadAll');
                                break;
                            }
                        }
                    });
                }
            });
        },

        // Need to call when gitlab takes callback's rout with oauth code
        onReceivedOAuthToken(context, access_token) {
            context.commit('setAccessToken', access_token);
            context.dispatch('reloadAll');
        },

        // Reload root manifest
        reloadAll(context) {
            context.commit('clean');
            context.dispatch('reloadRootManifest');
        },

        // Search and set document by URI
        selectDocumentByURI(context, uri) {
            for (let key in context.state.docs) {
                let document = context.state.docs[key];
                if (document.uri.toString() === uri) {
                    context.dispatch('selectDocument', document);
                    break;
                }
            }
        },

        // Set selected document
        selectDocument(context, document) {
            context.commit('setSelectedDocument', document);
        },

        // Reload root manifest
        updateLastChanges(context) {
            let request = new function () {
                this.terminate = false;
                this.projects_tasks = {};

                this.loadLastChange = (doc) => {
                    axios({
                        method: 'get',
                        url: GitHelper.commitsListURI(doc.project_id, doc.branch, 1, doc.source, 1),
                        headers: {'Authorization': `Bearer ${context.state.access_token}`}
                    })
                        .then((response) => {
                            if (!this.terminate) {
                                context.commit('appendLastChanges', {
                                    id: doc.id,
                                    payload: response.data
                                });
                            }
                        });
                };

                this.stop = () => {
                    this.terminate = true;
                }
            };

            for (let id in context.state.docs) {
                let doc = context.state.docs[id];
                if ((doc.transport || '').toLowerCase() === 'gitlab') {
                    request.loadLastChange(doc);
                }
            }
        },

        // Reload root manifest
        reloadRootManifest() {
            parser.import(requests.makeURIByBaseURI(config.root_manifest, requests.getSourceRoot()));
        },

        // Регистрация проблемы
        registerProblem(context, problem) {
            context.commit('appendProblem', problem);
        }
    }
};
