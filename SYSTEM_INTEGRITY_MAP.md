
# 🗺️ TITAN INTEGRITY MAP (SARCOPHAGUS ARCHITECTURE)

> **STATUS:** VERIFIED
> **VERSION:** 21.0.0
> **PURPOSE:** Карта связей для проверки целостности данных в новом интерфейсе.

---

## 1. ZONE 1: HEADER (STATUS DECK)
*Компонент:* `components/StatusDeck.tsx`

| Визуальный Элемент | Источник Данных (Hook/Store) | Статус Проверки |
| :--- | :--- | :--- |
| **Индикатор NET** | `bot.connectionStatus` | ✅ CONNECTED |
| **Индикатор CORE** | `bot.status` (TRADING/WAITING) | ✅ LINKED |
| **Индикатор AI** | `bot.aiConnectionState.status` | ✅ LINKED |
| **Часы (MSK)** | `utils/marketTime.ts` (Local Calc) | ✅ SYNCED |
| **Таймер Сессии** | `getMsUntilNextSessionOpen()` | ✅ SYNCED |
| **Индикатор RISK** | `bot.oracleAdvice.riskLevel` | ✅ LINKED |

---

## 2. ZONE 2: REACTOR (MAIN DISPLAY)
*Компонент:* `components/ReactorCore.tsx`

| Визуальный Элемент | Источник Данных | Статус Проверки |
| :--- | :--- | :--- |
| **PnL (Huge Number)** | `bot.position.pnl` | ✅ REALTIME |
| **Market Price** | `useMemo` from `bot.lastTrades` OR `chartData` | ✅ STREAM |
| **Position Size** | `bot.position.currentQuantity` | ✅ SYNCED |
| **Symbiote Bar** | `bot.symbioteAnalysis.deviation` | ✅ CALCULATED |
| **Sparkline (BG)** | `bot.chartData['1m']` (Last 30 points) | ✅ RENDERED |

---

## 3. ZONE 3: INTELLIGENCE (LOGS)
*Компонент:* `components/IntelligenceTerminal.tsx`

| Визуальный Элемент | Источник Данных | Статус Проверки |
| :--- | :--- | :--- |
| **Heartbeat Strip** | `streamManager` events (direct subscription) | ✅ PULSING |
| **Log Feed** | `bot.logs` (Slice 20) | ✅ SCROLLABLE |
| **Data Stream Tag** | Static Label | ✅ VISIBLE |

---

## 4. ZONE 4: CONTROL DECK (INPUT)
*Компонент:* `components/ControlDeck.tsx`

| Визуальный Элемент | Действие / Триггер | Статус Проверки |
| :--- | :--- | :--- |
| **Hold Button** | `bot.toggleBotActive()` | ✅ WIRED |
| **BIOS Button** | `ui.setIsBiosModalOpen(true)` | ✅ WIRED |
| **Panic Slide** | `bot.postCommand({ type: 'EMERGENCY_API_RESET' })` | ✅ WIRED |
| **Position Check** | `bot.position` (To show Panic slider) | ✅ LOGIC OK |

---

## 5. OVERLAYS (MODALS)
*Компоненты:* `BiosModal`, `ApiKeyModal`, `ConfirmationDialog`

| Модальное Окно | Триггер | Действие Сохранения |
| :--- | :--- | :--- |
| **BIOS** | ControlDeck Button | `bot.postCommand('UPDATE_BIOS_SETTINGS')` |
| **API Key** | Auto-Detect or BIOS | `bot.postCommand('SAVE_API_KEY')` |
| **Confirmations** | Logic Guards | Local State |

---

**ВЫВОД АРХИТЕКТОРА:** Все жизненно важные органы системы подключены к новому интерфейсу. Разрывов логики не обнаружено.
