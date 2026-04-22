
# ↩️ TITAN: PROTOCOL RECALL (EMERGENCY ROLLBACK)

> **ВНИМАНИЕ:** Использовать только в случае критического отказа интерфейса "Sarcophagus Prime" (черный экран, невозможность управления).

---

## ШАГ 1: ОТКАТ `Dashboard.tsx`

Если новый дашборд не работает, необходимо вернуть старую модульную структуру.

1.  Откройте `components/Dashboard.tsx`.
2.  Замените содержимое на Legacy Layout (код ниже).

### LEGACY LAYOUT SNIPPET

```tsx
// components/Dashboard.tsx (LEGACY MODE)
import React from 'react';
import { useTradingBot } from '../hooks/useTradingBot';
// ... imports

const Dashboard = () => {
    const bot = useTradingBot();
    
    // Fallback to old grid
    return (
        <div className="p-2 space-y-2 overflow-y-auto pb-20">
            <StatusPanel {...bot} />
            <ChartPanel data={bot.chartData['1m']} ... />
            <ConfigPanel ... />
            <LogPanel logs={bot.logs} />
        </div>
    );
};
export default Dashboard;
```

---

## ШАГ 2: СБРОС ВЕРСИИ

Если `SystemGuardian` блокирует запуск из-за несоответствия версий:

1.  Откройте `constants.ts`.
2.  Измените `PROJECT_VERSION` на последнюю работающую (например, `18.0.0`).
3.  Откройте `TITAN_MEMORY.json`.
4.  Измените `meta.version` на ту же версию (`18.0.0`).

---

## ШАГ 3: ОЧИСТКА КЕША

Если проблема в битых данных (`IndexedDB`):

1.  Откройте DevTools в браузере (F12).
2.  Перейдите в Application -> Storage.
3.  Нажмите "Clear Site Data".
4.  Перезагрузите страницу.

---

**АРХИВ:** Файлы старых компонентов (`StatusPanel`, `ChartPanel`, `ConfigPanel`) **НЕ УДАЛЕНЫ**. Они находятся в папке `components/` и готовы к повторному подключению в любой момент.
