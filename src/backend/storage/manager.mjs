import logger from '../utils/logger.mjs';
import manifestParser from '../../global/manifest/parser.mjs';
import cache from './cache.mjs';
import md5 from 'md5';
import events from '../helpers/events.mjs';
import validators from '../helpers/validators.mjs';
import entities from '../entities/entities.mjs';
import objectHash from 'object-hash';
import jsonataDriver from '../../global/jsonata/driver.mjs';
import jsonataFunctions from '../../global/jsonata/functions.mjs';

const LOG_TAG = 'storage-manager';

manifestParser.cache = cache;

manifestParser.onError = (error) => {
	logger.error(`Error of loading manifest ${error}`, LOG_TAG);
};

// eslint-disable-next-line no-unused-vars
manifestParser.onStartReload = (parser) => {
	logger.log('Manifest start reloading', LOG_TAG);
};

// eslint-disable-next-line no-unused-vars
manifestParser.onReloaded = (parser) => {
	logger.log('Manifest is reloaded', LOG_TAG);
};

export default {
	// Кэш для пользовательских функций
	cacheFunction: null,
	// Регистрация пользовательских функций
	resetCustomFunctions(storage) {
		this.cacheFunction = null;

		jsonataDriver.customFunctions = () => {
			if (!this.cacheFunction)
				this.cacheFunction = jsonataFunctions(jsonataDriver, storage.functions || {});
			return this.cacheFunction;
		};
		
	},
	// Стек обработчиков события на обновление манифеста
	onApplyManifest: [],
	reloadManifest: async function() {
		logger.log('Run full reload manifest', LOG_TAG);
		// Загрузку начинаем с виртуального манифеста
		cache.errorClear();
		await manifestParser.clean();
		await manifestParser.startLoad();
		await manifestParser.import('file:///$root$');
		await manifestParser.checkAwaitedPackages();
		await manifestParser.checkLoaded();
		await manifestParser.stopLoad();

		entities(manifestParser.manifest);

		logger.log('Full reload is done', LOG_TAG);
		const result = {
			manifest: manifestParser.manifest,			// Сформированный манифест
			hash: objectHash(manifestParser.manifest),	// HASH состояния для контроля в кластере
			mergeMap: {},								// Карта склейки объектов
			md5Map: {},									// Карта путей к ресурсам по md5 пути
			// Ошибки, которые возникли при загрузке манифестов
			// по умолчанию заполняем ошибками, которые возникли при загрузке
			problems: Object.keys(cache.errors || {}).map((key) => cache.errors[key]) || []
		};

		// Выводим информацию о текущем hash состояния
		logger.log(`Hash of manifest is ${result.hash}`, LOG_TAG);

		// Если есть ошибки загрузки, то дергаем callback 
		result.problems.length && events.onFoundLoadingError();

		for (const path in manifestParser.mergeMap) {
			result.mergeMap[path] = manifestParser.mergeMap[path].map((url) => {
				const hash = md5(path);
				result.md5Map[hash] = url;
				return `backend://${hash}/`;
			});
		}
		return result;
	},
	applyManifest: async function(app, storage) {
		app.storage = storage;  // Инициализируем данные хранилища
		this.resetCustomFunctions(storage.manifest);
		validators(app);        // Выполняет валидаторы
		Object.freeze(app.storage);
		this.onApplyManifest.map((listener) => listener(app));
	},
	cleanStorage(app) {
		this.cacheFunction = null;
		app.storage = undefined;
	}
};

