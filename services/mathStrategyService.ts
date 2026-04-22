
/**
 * TITAN TRADING BOT - MATH CORE (THE PIGGY BANK)
 * ---------------------------------------------------------
 * @module services/mathStrategyService.ts
 * @version 35.5.0 (CASH GUARD)
 * ---------------------------------------------------------
 */

import { TradeDirection, InstrumentDetails, VirtualOrder, ChartDataPoint } from '../types';
import { roundPriceToTick } from '../utils/math';
import * as debugService from './debugService'; 

// --- SNIPER LOGIC (REŽIM №2) ---

/**
 * Calculates Average True Range (ATR)
 * Standard formula for moving volatility.
 */
export const calculateATR = (candles: ChartDataPoint[], period: number = 14): number => {
    if (!candles || candles.length < period + 1) return 0;
    
    let trSum = 0;
    // We need 'period' number of True Ranges. So we look at the last 'period' candles
    // Each TR needs the previous candle's close.
    for (let i = candles.length - period; i < candles.length; i++) {
        const current = candles[i];
        const previous = candles[i - 1];
        
        const highLow = current.high - current.low;
        const highClose = Math.abs(current.high - previous.price); // Using price as close
        const lowClose = Math.abs(current.low - previous.price);
        
        const tr = Math.max(highLow, highClose, lowClose);
        trSum += tr;
    }
    
    return trSum / period;
};

/**
 * Calculates Average Directional Index (ADX)
 * Identifies trend strength (ADX > 25 = Trending, ADX < 25 = Ranging)
 */
export const calculateADX = (candles: ChartDataPoint[], period: number = 14): number => {
    if (!candles || candles.length < period * 2) return 0;

    let trSmoothed = 0, pDmSmoothed = 0, nDmSmoothed = 0;
    let dxSum = 0;

    const wilderSmooth = (prev: number, val: number) => prev - (prev / period) + val;

    for (let i = 1; i <= period; i++) {
        const current = candles[i];
        const prev = candles[i - 1];

        const tr = Math.max(current.high - current.low, Math.abs(current.high - prev.price), Math.abs(current.low - prev.price));
        const upMove = current.high - prev.high;
        const downMove = prev.low - current.low;

        let pDM = 0, nDM = 0;
        if (upMove > downMove && upMove > 0) pDM = upMove;
        if (downMove > upMove && downMove > 0) nDM = downMove;

        trSmoothed += tr;
        pDmSmoothed += pDM;
        nDmSmoothed += nDM;
    }

    let adx = 0;

    for (let i = period + 1; i < candles.length; i++) {
        const current = candles[i];
        const prev = candles[i - 1];

        const tr = Math.max(current.high - current.low, Math.abs(current.high - prev.price), Math.abs(current.low - prev.price));
        const upMove = current.high - prev.high;
        const downMove = prev.low - current.low;

        let pDM = 0, nDM = 0;
        if (upMove > downMove && upMove > 0) pDM = upMove;
        if (downMove > upMove && downMove > 0) nDM = downMove;

        trSmoothed = wilderSmooth(trSmoothed, tr);
        pDmSmoothed = wilderSmooth(pDmSmoothed, pDM);
        nDmSmoothed = wilderSmooth(nDmSmoothed, nDM);

        const diPlus = trSmoothed === 0 ? 0 : 100 * (pDmSmoothed / trSmoothed);
        const diMinus = trSmoothed === 0 ? 0 : 100 * (nDmSmoothed / trSmoothed);

        const dx = (diPlus + diMinus === 0) ? 0 : 100 * Math.abs(diPlus - diMinus) / (diPlus + diMinus);

        if (i === period * 2) {
            dxSum += dx;
            adx = dxSum / period;
        } else if (i > period * 2) {
            adx = ((adx * (period - 1)) + dx) / period;
        } else {
             dxSum += dx;
        }
    }

    return adx || 0;
};

/**
 * Detects Market Regime based on ADX (14)
 */
export const detectMarketRegime = (candles: ChartDataPoint[]): 'TRENDING' | 'RANGING' => {
    // We calculate ADX. Generally ADX > 25 indicates a strong trend.
    const adx = calculateADX(candles, 14);
    if (adx >= 25) return 'TRENDING';
    return 'RANGING';
};

// --- T-TECH ADAPTIVE MATH CORE (PHASE 1) ---

/**
 * Вспомогательная функция для расчета SMA (Simple Moving Average) от массива чисел
 */
const calculateSMA = (data: number[], period: number): number => {
    if (data.length < period) return 0;
    const slice = data.slice(-period);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / period;
};

/**
 * Вспомогательная функция для расчета Standard Deviation (StdDev) от массива чисел
 */
const calculateStdDev = (data: number[], period: number, sma: number): number => {
    if (data.length < period) return 0;
    const slice = data.slice(-period);
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
    return Math.sqrt(variance);
};

export interface APZBounds {
    upper: number;
    lower: number;
}

/**
 * T-TECH: Adaptive Price Zone (APZ)
 * Basis = (High + Low) / 2
 * APZ_Upper = SMA(Basis, Period) + StdDev(Basis, Period) * 2
 * APZ_Lower = SMA(Basis, Period) - StdDev(Basis, Period) * 2
 */
export const calculateAPZ = (candles: ChartDataPoint[], period: number = 20): APZBounds => {
    if (!candles || candles.length < period) return { upper: 0, lower: 0 };
    
    // Формируем массив Basis (H+L)/2
    const basisArray = candles.map(c => (c.high + c.low) / 2);
    
    const currentSMA = calculateSMA(basisArray, period);
    const currentStdDev = calculateStdDev(basisArray, period, currentSMA);
    
    return {
        upper: currentSMA + (currentStdDev * 2),
        lower: currentSMA - (currentStdDev * 2)
    };
};

/**
 * T-TECH: Normalized ATR (nATR)
 * Вычисляет ATR за 14 периодов, затем берет SMA от истории ATR за 50 периодов.
 * Возвращает отношение текущего ATR14 / SMA50(ATR14).
 */
export const calculateNATR = (candles: ChartDataPoint[], atrPeriod: number = 14, smaPeriod: number = 50): number => {
    const requiredLength = atrPeriod + smaPeriod;
    if (!candles || candles.length < requiredLength) return 1.0; // Базовое значение при нехватке данных

    // Получаем историю значений ATR. Нам нужно получить 'smaPeriod' штук ATR.
    // Значит начинаем прогон с индекса (length - smaPeriod)
    const atrHistory: number[] = [];
    
    for (let i = candles.length - smaPeriod; i <= candles.length; i++) {
        // Мы передаем срез свечей, где последней является i-я свеча, чтобы calculateATR посчитал ATR ИМЕННО на момент i
        const slice = candles.slice(0, i);
        const atrValue = calculateATR(slice, atrPeriod);
        if (atrValue > 0) {
            atrHistory.push(atrValue);
        }
    }

    if (atrHistory.length === 0) return 1.0;

    const currentATR = atrHistory[atrHistory.length - 1];
    const smaATR = calculateSMA(atrHistory, atrHistory.length); // Усредняем все собранные ATR (около 50)

    if (smaATR === 0) return 1.0;
    
    return currentATR / smaATR;
};

export interface DonchianChannels {
    upper: number;
    lower: number;
}

/**
 * T-TECH: Donchian Channels
 * Upper = Highest High
 * Lower = Lowest Low
 */
export const calculateDonchianChannels = (candles: ChartDataPoint[], period: number = 20): DonchianChannels => {
    if (!candles || candles.length < period) return { upper: 0, lower: 0 };
    
    const slice = candles.slice(-period);
    
    let highestHigh = -Infinity;
    let lowestLow = Infinity;

    for (const candle of slice) {
        if (candle.high > highestHigh) highestHigh = candle.high;
        if (candle.low < lowestLow) lowestLow = candle.low;
    }

    return {
        upper: highestHigh,
        lower: lowestLow
    };
};


// --- T-TECH ADAPTIVE GRID (PHASE 2) ---

/**
 * T-TECH: Генератор Адаптивной Сетки
 * Использует динамический шаг (по nATR), веса Фибоначчи и хардкод-фильтры.
 */
export const calculateAdaptiveTTechGrid = (
    basePrice: number,         // Опорная цена (P0 или смещенная по тренду)
    avgPrice: number,          // Текущая средняя цена позиции (если есть)
    realQty: number,           // Текущее количество акций
    availableCash: number,     // Бюджет из свободных денег для лесенки покупок
    instrumentDetails: InstrumentDetails,
    apz: APZBounds,
    nATR: number
): VirtualOrder[] => {
    const orders: VirtualOrder[] = [];
    const lotSize = instrumentDetails.lot || 1;
    const tickSize = instrumentDetails.minPriceIncrement || 0.01;

    // 1. Динамический шаг сетки
    let stepPct = 0.003; // База 0.3%
    if (nATR > 1.2) {
        stepPct = 0.003 * 1.5; // Расширяем (0.45%) в шторм
    } else if (nATR < 0.8) {
        stepPct = 0.003 * 0.7; // Сужаем (0.21%) в штиль
    }

    // --- BUY GRID (Лесенка покупок - 7 уровней Фибоначчи) ---
    const BUY_WEIGHTS = [1, 2, 3, 5, 8, 13, 21];
    
    interface BuyLevel { index: number; price: number; weight: number; }
    const validBuyLevels: BuyLevel[] = [];
    let totalBuyWeight = 0;

    for (let i = 1; i <= 7; i++) {
        // Мы всегда выставляем сетку, чтобы забрать даже проливы ниже APZ.
        let rawPrice = basePrice * (1 - i * stepPct);
        const limitPrice = roundPriceToTick(rawPrice, tickSize);
        
        const weight = BUY_WEIGHTS[i - 1];
        validBuyLevels.push({ index: i, price: limitPrice, weight });
        totalBuyWeight += weight;
    }

    // Распределяем доступный кэш по валидным уровням
    let remainingCash = availableCash;
    for (let i = 0; i < validBuyLevels.length; i++) {
        const level = validBuyLevels[i];
        const cashForLevel = availableCash * (level.weight / totalBuyWeight);
        let actualCash = Math.min(cashForLevel, remainingCash);
        
        // Весь остаток вываливаем на последний возможный уровень (чтобы не оставалось копеек)
        if (i === validBuyLevels.length - 1) {
            actualCash = remainingCash;
        }

        const qty = Math.floor(actualCash / (level.price * lotSize));
        if (qty > 0) {
            orders.push({
                price: level.price,
                volume: qty,
                direction: TradeDirection.BUY,
                levelIndex: level.index,
                metadata: { reason: 'ADAPTIVE_BUY' }
            });
            remainingCash -= (qty * level.price * lotSize);
        }
    }

    // --- SELL GRID (Лесенка продаж - 3 уровня Ретро) ---
    if (realQty > 0 && avgPrice > 0) {
        const SELL_WEIGHTS = [3, 2, 1];
        
        interface SellLevel { index: number; price: number; weight: number; }
        const validSellLevels: SellLevel[] = [];
        let totalSellWeight = 0;

        for (let i = 1; i <= 3; i++) {
            // Целевая цена берется как максимум из (средней + мин.профит) и (уровня сетки от текущей базы)
            // Это гарантирует, что мы всегда продаем в плюс, даже если база ушла вниз
            const minProfitTarget = avgPrice * (1 + (i * 0.003));
            let rawPrice = Math.max(basePrice * (1 + i * stepPct), minProfitTarget);
            
            const limitPrice = roundPriceToTick(rawPrice, tickSize);

            // Фильтр: мы убрали ограничение apz.upper, так как нам НАДО выставить лимитки на продажу!
            if (limitPrice > avgPrice) {
                const weight = SELL_WEIGHTS[i - 1];
                validSellLevels.push({ index: i, price: limitPrice, weight });
                totalSellWeight += weight;
            }
        }

        let remainingQty = realQty;
        for (let i = 0; i < validSellLevels.length; i++) {
            const level = validSellLevels[i];
            const qtyForLevel = Math.floor(realQty * (level.weight / totalSellWeight));
            let actualQty = Math.min(qtyForLevel, remainingQty);

            if (i === validSellLevels.length - 1) {
                actualQty = remainingQty;
            }

            if (actualQty > 0) {
                const brokerFeePrct = 0.0004; // 0.04% за сделку
                const netProfit = ((level.price * (1 - brokerFeePrct)) / (avgPrice * (1 + brokerFeePrct)) - 1) * 100;

                orders.push({
                    price: level.price,
                    volume: actualQty,
                    direction: TradeDirection.SELL,
                    levelIndex: level.index,
                    metadata: { 
                        reason: 'ADAPTIVE_SELL',
                        expectedProfit: netProfit,
                        targetPrice: avgPrice
                    }
                });
                remainingQty -= actualQty;
            }
        }
    }

    return orders;
};

