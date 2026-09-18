/** Цвета бейджей заявок — общий модуль для списка и карточки (файлы страниц не могут экспортировать лишнее). */
export const PRIORITY_TONE = { LOW: 'gray', NORMAL: 'blue', HIGH: 'yellow', CRITICAL: 'red' } as const;
export const STATUS_TONE = { OPEN: 'red', ASSIGNED: 'yellow', IN_PROGRESS: 'blue', DONE: 'green', VERIFIED: 'green', CANCELLED: 'gray' } as const;
