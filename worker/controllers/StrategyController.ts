
import type { BotKernel } from '../bot-kernel';
import { LogType, BotStatus } from '../../types';
import { isMarketOpenNow, isWeekend, isTradeAllowedForInstrument } from '../../utils/marketTime';

export class StrategyController {
    private isBusy = false;

    constructor(private kernel: BotKernel) {}

    public async _runStrategistTask() {
        if (this.isBusy) return;
        this.isBusy = true;

        const state = this.kernel.getState();
        const classCode = state.instrumentDetails?.classCode || '';

        // --- MONDAY COMA FIX ---
        if (state.status === BotStatus.MARKET_CLOSED) {
            if (isTradeAllowedForInstrument(classCode)) {
                this.kernel.log(LogType.SUCCESS, "🌅 РЫНОК ОТКРЫЛСЯ. Пробуждение...", 'StrategyController', { classCode });
                this.kernel.updateState({ status: BotStatus.TRADING }, true);
            } else {
                this.isBusy = false;
                return;
            }
        }

        // --- ACTIVE GUARD ---
        if (state.isBotActive && state.status === BotStatus.TRADING) {
             const isAllowed = isTradeAllowedForInstrument(classCode);
             if (!isAllowed) {
                 this.kernel.log(LogType.WARNING, `🌙 РЫНОК ЗАКРЫТ. Режим сна.`, 'StrategyController', { classCode });
                 this.kernel.updateState({ status: BotStatus.MARKET_CLOSED });
                 this.isBusy = false;
                 return;
             }
        }

        if (!state.isBotActive || state.status !== BotStatus.TRADING) {
            this.isBusy = false;
            return;
        }

        try {
            // ЕДИНАЯ СТРАТЕГИЯ: VORTEX v2.1 Lifecycle
            await this.kernel.orderController.processLifeCycle();
        } catch (e: any) {
            this.kernel.log(LogType.WARNING, `Strategy Glitch: ${e.message}`, 'StrategyController', { error: e.message });
        } finally {
            this.isBusy = false;
        }
    }
}
