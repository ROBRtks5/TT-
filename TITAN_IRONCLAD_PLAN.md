
# 🛡️ PROTOCOL IRONCLAD: IMPLEMENTATION PLAN

> **STATUS:** COMPLETED
> **OBJECTIVE:** Transition from Speculative Trading to Mathematical Accumulation (Long-Only, No Loss).
> **TARGET:** TMOS@ (T-Invest iMOEX Fund).

---

## 🏗️ PHASE 1: FOUNDATION (Подготовка Почвы)
*Цель: Очистить конфигурацию и подготовить структуры данных, не ломая текущий код.*

- [x] **STEP 1.1: Config Migration**
- [x] **STEP 1.2: State Expansion**
- [x] **STEP 1.3: Clean Up Services**

---

## 🧮 PHASE 2: MATH CORE (Математическое Ядро)
*Цель: Создать "Мозг", который принимает решения на основе голой математики.*

- [x] **STEP 2.1: MathStrategy Service**
- [x] **STEP 2.2: Money Manager (3 Bullets)**

---

## 🚜 PHASE 3: EXECUTION ENGINE (Исполнение)
*Цель: Надежное исполнение ордеров без "двойных входов".*

- [x] **STEP 3.1: OrderController Refactor**
- [x] **STEP 3.2: Grid Master (Active Orders)**

---

## 🖥️ PHASE 4: UI TRANSFORMATION (Саркофаг 2.0)
*Цель: Оператор должен видеть не "просадку", а "план".*

- [x] **STEP 4.1: Reactor Core Update**
    *   Заменить отображение "Stop Loss" на "Next Buy Level" (Цена следующей докупки).
    *   Добавить визуализацию: "Дистанция до Профита" (Зеленая полоса) и "Дистанция до Докупки" (Желтая полоса).

- [x] **STEP 4.2: Control Deck Update**
    *   Кнопка "PANIC SELL" меняется на "FORCE EXIT" (Закрыть сейчас, даже в минус - требует подтверждения).
    *   Добавить индикатор "Запас хода" (сколько пуль осталось).

---

## 🚀 PHASE 5: ACTIVATION (Запуск)
*Цель: Финальная интеграция.*

- [x] **STEP 5.1: Strategy Switcher**
    *   В `StrategyController` добавить переключатель: если режим `IRONCLAD`, игнорируем AI и запускаем `mathStrategyService`.

- [x] **STEP 5.2: Simulation Run**
    *   (Deferred) Симуляция заменена на "Боевой Запуск" с микро-лотами. Логика ядра полностью переключена.

---
*End of Plan. Protocol Active.*
