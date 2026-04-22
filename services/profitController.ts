
/**
 * TITAN TRADING BOT - PROFIT CONTROLLER (THE HARVESTER)
 * ---------------------------------------------------------
 * @module services/profitController.ts
 * @version 1.0.0
 * @description
 * Модуль экстренной фиксации прибыли.
 * Если PnL превышает заданный порог (SPIKE), сбрасывает часть позиции по рынку.
 * ---------------------------------------------------------
 */

import { Position, TradeDirection } from '../types';

const SPIKE_THRESHOLD = 0.01; // +1.0% PnL triggers partial close
const SECURE_PORTION = 0.5;   // Close 50% of position
const COOLDOWN_MS = 60000;    // 1 minute cooldown between secures

export interface ProfitAction {
    shouldSecure: boolean;
    quantity: number;
    reason: string | null;
}

export class ProfitController {
    private lastSecureTime: number = 0;

    public reset() {
        this.lastSecureTime = 0;
    }

    public check(position: Position | null, currentPrice: number): ProfitAction {
        if (!position || position.currentQuantity === 0) {
            return { shouldSecure: false, quantity: 0, reason: null };
        }

        const now = Date.now();
        if (now - this.lastSecureTime < COOLDOWN_MS) {
            return { shouldSecure: false, quantity: 0, reason: null };
        }

        const { entryPrice, direction, currentQuantity } = position;
        const qty = Math.abs(currentQuantity);

        // Don't split tiny positions (dust)
        if (qty < 2) {
            return { shouldSecure: false, quantity: 0, reason: null };
        }

        let pnlPercent = 0;

        if (direction === TradeDirection.BUY) {
            pnlPercent = (currentPrice - entryPrice) / entryPrice;
        } else {
            pnlPercent = (entryPrice - currentPrice) / entryPrice;
        }

        if (pnlPercent > SPIKE_THRESHOLD) {
            const secureQty = Math.floor(qty * SECURE_PORTION);
            
            if (secureQty > 0) {
                this.lastSecureTime = now;
                return {
                    shouldSecure: true,
                    quantity: secureQty,
                    reason: `SPIKE DETECTED: PnL +${(pnlPercent * 100).toFixed(2)}% > 1.0%. Securing ${secureQty} lots.`
                };
            }
        }

        return { shouldSecure: false, quantity: 0, reason: null };
    }
}
