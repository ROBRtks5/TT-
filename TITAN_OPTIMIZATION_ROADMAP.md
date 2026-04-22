# TITAN PROTOCOL: V2 OPTIMIZATION ROADMAP

## CURRENT STATUS
**Phase Triggered:** Optimization Wave 2
**Code Word:** TITAN_POLISH

## OBJECTIVE
Conduct a top-to-bottom audit and optimization of the entire codebase. Focus on removing dead code, resolving inconsistencies, fixing UI blind spots, mapping race conditions, and aligning the interface with backend capabilities.

---

## CHECKLIST & PROGRESS

### LEVEL 1: USER INTERFACE (CONTROL DECK & DASHBOARD)
- [x] **Strategy Toggles Missing/Hidden:** The `ControlDeck.tsx` currently wraps the strategy toggles in a `isBotActive ? 'opacity-40 pointer-events-none' : ''` div. This prevents the user from switching strategies (or engaging AUTO mode) while the bot is running. Since the backend now supports `executeStrategyHandover`, these buttons must be unlocked and restyled to clearly display 'AMM', 'SNIPER', and 'AUTO' active states with Lucide icons.
- [x] **Dead 'WinRate' Stats:** The `Dashboard.tsx` calculates Win Rate based on `bot.tradeHistory`. However, `tradeHistory` is never actively populated by the backend when an order fills. Needs to be wired up dynamically in `OrderController.ts` inside `handleOrderFill` or via stream events.
- [x] **UI/UX Polish:** Improve contrast and alignment of new features.

### LEVEL 2: DATA & STATE INTEGRITY
- [x] **State Ghosts / Dead Code:** Removed 15+ legacy services, 10+ unused UI components, and hundreds of lines of dead types/initialState properties. Bot is now strictly AMM-SNIPER-AUTO focused.
- [x] **History Array Bounds:** Added `.slice(-50)` limiters to `tradeHistory` and logic was already partially present in `logs` and `lastTrades`. Memory stability improved.

### LEVEL 3: BOT KERNEL & PERFORMANCE LIMITS
- [x] **Stream Cleanup Validation:** Verified `streamManager.disconnect()` and cleanup logic in `BotKernel`.
- [x] **Race Condition Polish:** Refined `DataController` and `OrderController` to prevent data contamination and handle state transitions safely.
- [x] **Lint-Clean System:** Resolved all TypeScript errors resulting from the mass deletion of legacy code.


---

**Execution Protocol:** 
When the user says the code word `TITAN_POLISH`, the AI agent will refer to this document, check off the completed tasks, and move to the next item sequentially.
