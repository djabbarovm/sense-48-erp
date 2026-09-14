# Finance OS

Multi-tenant Finance Operations platform. Спецификация — `CLAUDE.md` + `docs/`. Мастер-промпт для Claude Code — `MASTER_PROMPT.md`.

## Как запустить разработку с Claude Code

1. Создай пустой git-репозиторий и скопируй в корень содержимое этого пакета.
2. `git add . && git commit -m "spec: Finance OS v1.0"`.
3. Запусти `claude` в корне.
4. Вставь содержимое `MASTER_PROMPT.md` первым сообщением.
5. Claude Code читает `CLAUDE.md` автоматически при каждом запуске; продолжение работы после перерыва — просто `claude` и «продолжай по TASKS.md».

## Структура пакета

```
CLAUDE.md          точка входа и правила для Claude Code
MASTER_PROMPT.md   первое сообщение
docs/00–12         спецификация
templates/         Excel-шаблоны миграции (описание колонок; файлы генерирует Phase E-05)
TASKS.md DECISIONS.md CHANGELOG.md   рабочие журналы
```

(Раздел «Как запустить приложение» заполняет Claude Code в Phase A-02.)
