# TITAN: ADAPTIVE LADDER T-TECH (IMPLEMENTATION PLAN)

Этот план описывает модульную миграцию стабильного протокола TITAN-70-30 на продвинутую адаптивную сетку с динамическим шагом, каналами Дончана и развесовкой Фибоначчи.

## ФАЗА 1: Математическое ядро (Индикаторы) - [✅ ЗАВЕРШЕНО]
- [x] Функция: `calculateAPZ(candles, period = 20)`
  - Расчет `Upper_Bound` и `Lower_Bound` по формуле (SMA +/- StdDev * 2).
- [x] Функция: `calculateNATR(candles)`
  - Расчет `ATR14`, расчет `SMA50` от `ATR14`, итоговый `nATR = ATR14 / SMA_ATR50`.
- [x] Функция: `calculateDonchianChannels(candles, period = 20)`
  - Расчет `Upper_Donch` (Max High) и `Lower_Donch` (Min Low) за 20 периодов.

## ФАЗА 2: Генератор Адаптивной Сетки - [✅ ЗАВЕРШЕНО]
- [x] Замена `calculateTitan7030Grid` на `calculateAdaptiveTTechGrid` в `mathStrategyService.ts`.
- [x] Внедрение динамического шага:
  - Base: `0.3%` от текущей цены.
  - Умножители: `nATR > 1.2 -> *1.5`, `nATR < 0.8 -> *0.7`.
- [x] Распределение объемов:
  - BUY (7 уровней): Фибоначчи `[1, 2, 3, 5, 8, 13, 21]` (Нормализация с округлением до минимум 1 лота).
  - SELL (3 уровня): Регрессивное `[3, 2, 1]`.
- [x] Граничные фильтры:
  - BUY не ниже `APZ_Lower`.
  - SELL не выше `APZ_Upper` и строго `> Avg_Price * 1.003`.

## ФАЗА 3: Контроллер Режимов (Donchian Trend Surfing) - [✅ ЗАВЕРШЕНО]
- [x] Анализ последних закрытых свечей в `StrategyController` (перенесено в `processAdaptiveTTech`).
- [x] Сборка логики переключения (State Machine): `TREND_UP`, `TREND_DOWN`, `FLAT`.
- [x] При `TREND_UP` / `TREND_DOWN`: Смещение центра лесенки вверх/вниз (`adaptiveBasePrice`).

## ФАЗА 4: Реактивная петля (Event-driven Rebuild) - [✅ ЗАВЕРШЕНО]
- [x] Подключение обработчика `FILL` (выполнения лимитки).
- [x] Сброс фильтра фликеринга при срабатывании для моментального триггера.
- [x] Запуск перестроения (Rebuild) сетки адаптивным методом.

---
*Статус: Все 4 Фазы архитектуры T-TECH ADAPTIVE успешно интегрированы и запущены в основном Ядре (BotKernel).*
