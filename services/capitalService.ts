
/**
 * TITAN TRADING BOT - CAPITAL MANAGEMENT (STRICT CASH)
 * ---------------------------------------------------------
 * @module services/capitalService.ts
 * @version 8.1.1 (NAN GUARD)
 * @description
 * Модуль управления капиталом.
 * UPD 8.1.1: Added Math.max(0) guards to prevent negative power.
 * ---------------------------------------------------------
 */

import { MarginAttributes, InstrumentDetails, GridOrder, TradeDirection, AmmCapitalState } from '../types';
import { BUYING_POWER_SAFETY_MARGIN } from '../constants';

/**
 * Calculates funds locked in active orders.
 */
export const calculateLockedFunds = (orders: GridOrder[] | null, instrumentDetails: InstrumentDetails | null, includeExchangeOrders: boolean = false): number => {
    if (!orders || orders.length === 0 || !instrumentDetails) return 0;
    
    const lotSize = instrumentDetails.lot || 1;
    let sum = 0;
    
    for (const o of orders) {
        if (o.direction === TradeDirection.BUY && 
            (o.status === 'OPTIMISTIC' || o.status === 'UNKNOWN' || (includeExchangeOrders && o.status === 'PENDING'))) {
            sum += o.price * o.qty * lotSize;
        }
    }
    
    return sum;
};

/**
 * Calculates TITAN-70-30 Capital Allocation
 */
export const calculateAmmCapitalAllocation = (
    cashBalance: number,
    currentAssetQty: number,
    currentAssetPrice: number,
    lotSize: number,
    liquidityFundValue: number = 0
): AmmCapitalState => {
    const totalAssetValue = currentAssetQty * currentAssetPrice * lotSize;
    
    // Total capital MUST be manually reconstructed to isolate the bot's funds 
    // from other random assets the user might be holding in Tinkoff.
    const totalCapitalValue = cashBalance + liquidityFundValue + totalAssetValue;

    // TITAN PROTOCOL: 30% Target Position, 70% Grid Reserves
    const targetGridCash = totalCapitalValue * 0.70;
    const targetGridAssetValue = totalCapitalValue * 0.30;

    const gridAssetQty = currentAssetQty;
    const gridAssetValue = gridAssetQty * currentAssetPrice * lotSize;

    return {
        totalCapitalValue,
        gridCash: cashBalance,
        gridAssetQty,
        gridAssetValue,
        targetGridCash,
        targetGridAssetValue,
        liquidityFundValue
    };
};

/**
 * Calculates Effective Buying Power based STRICTLY on Cash.
 */
export const calculateEffectiveBuyingPower = (
    marginData: MarginAttributes | null, 
    instrumentDetails: InstrumentDetails | null, 
    cashBalance: number = 0,
    activeOrdersLocked: number = 0
): number => {
    
    // 1. TRUE CASH DETERMINATION
    // Если брокер отдает 0 в fundsForBuy, принудительно используем реальный CashBalance счета.
    let grossCash = Math.max(0, cashBalance);
    
    if (marginData && marginData.fundsForBuy !== undefined) {
        // В режиме CASH мы всегда берем минимальное доступное, чтобы не "галлюцинировать" плечо
        if (marginData.fundsForBuy < grossCash) {
            grossCash = marginData.fundsForBuy;
        }
    }

    // Если локально есть "летящие" ордера, которые брокер ещё не учел в margins (асинхронный лаг),
    // МЫ ОБЯЗАНЫ их отнять, иначе мы задублируем лесенку, если брокер задержит ответ.
    grossCash -= activeOrdersLocked;

    const freeCash = Math.max(0, grossCash); 
    return Math.max(0, freeCash * BUYING_POWER_SAFETY_MARGIN);
};
