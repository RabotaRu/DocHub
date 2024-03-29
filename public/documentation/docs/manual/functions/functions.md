# Функции (functions)

**ВНИМАНИЕ: Функционал в beta тестировании.**

Функции необходимы для декларирования операций, которые могут быть вызваны из JSONata запросов.
Они способны принимать параметры, обрабатывать данные и возвращать результаты, контролируя 
структуру данных на входе и выходе.

Рекомендуется использовать функции для упрощения кода, повышения его читабельности, оптимизации и надежности.

Простой пример функции:
```yaml
functions:
  demo_summ:
    title: Простой пример сложения массива
    # Входящие параметры
    params:
      # Для каждого параметра описывается JSONSchema
      - alias: items    # Если задан alias, в функции будет доступна переменная с этим идентификатором
        type: array     # Требуем на вход массив
        items:
          type: number  # Элементы массива должны быть числами
        minItems: 1     # Минимум должен быть 1 элемент массива
        title: Объект конвертации
        required: true  # Признак обязательности параметра функции
    # JSONSchema схема результата. Не обязательно.
    result:
      type: number
    # Код функции
    code: >
      (
        /* В items будет передан массив значений для суммирования */
        /* Для реализации функции используется встроенная функция JSONata $sum() */
        $sum(items)
      )
```

После декларирования функции ее можно вызвать из JSONata запроса:
```JSONata
$demo_summ([1,2,3,4,5,15])
```

Результатом выполнения запроса будет:
```
30
```

Для самостоятельного тестирования работы функции воспользуйтесь [редактором запросов](/devtool).



