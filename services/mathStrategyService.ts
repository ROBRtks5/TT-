
/**
 * TITAN TRADING BOT - MATH CORE (THE PIGGY BANK)
 * ---------------------------------------------------------
 * @module services/mathStrategyService.ts
 * @version 35.6.0 (CASH GUARD + TELEMETRY)
 * ---------------------------------------------------------
 */

import { TradeDirection, InstrumentDetails, VirtualOrder, ChartDataPoint, MarketPhase } from '../types';
import { roundPriceToTick } from '../utils/math';
import * as debugService from './debugService'; 

// --- SNIPER LOGIC (REŽIM №2) ---

/**
 * Calculates Relative Strength Index (RSI)
 */
export const calculateRSI = (candles: ChartDataPoint[], period: number = 14): number => {
    // Optimization: limit the input size to period * 10
    const maxCandles = period * 10;
    const workingSet = candles.length > maxCandles ? candles.slice(-maxCandles) : candles;

    if (!workingSet || workingSet.length < period + 1) return 50;

    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 1; i <= period; i++) {
        const diff = workingSet[i].price - workingSet[i - 1].price;
        if (diff > 0) avgGain += diff;
        else avgLoss += Math.abs(diff);
    }

    avgGain /= period;
    avgLoss /= period;

    for (let i = period + 1; i < workingSet.length; i++) {
        const diff = workingSet[i].price - workingSet[i - 1].price;
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? Math.abs(diff) : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
};

/**
 * Determines the market phase based on RSI and ADX.
 */
export const determineMarketPhase = (rsi: number, adx: number): MarketPhase => {
    if (rsi > 80 && adx > 30) return MarketPhase.EUPHORIA;
    if (rsi > 60 && adx > 25) return MarketPhase.EXPANSION;
    if (rsi < 20 && adx > 30) return MarketPhase.PANIC;
    if (rsi < 40 && adx > 25) return MarketPhase.DECLINE;
    if (rsi >= 40 && rsi <= 60 && adx < 20) return MarketPhase.ACCUMULATION;
    if (rsi > 60 && adx < 20) return MarketPhase.DISTRIBUTION;
    return MarketPhase.NEUTRAL;
};

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
    // Optimization: limit the input size to period * 10. Wilder's smoothing converges quickly.
    const maxCandles = period * 10;
    const workingSet = candles.length > maxCandles ? candles.slice(-maxCandles) : candles;

    if (!workingSet || workingSet.length < period * 2) return 0;

    let trSmoothed = 0, pDmSmoothed = 0, nDmSmoothed = 0;
    let dxSum = 0;

    const wilderSmooth = (prev: number, val: number) => prev - (prev / period) + val;

    for (let i = 1; i <= period; i++) {
        const current = workingSet[i];
        const prev = workingSet[i - 1];

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

    for (let i = period + 1; i < workingSet.length; i++) {
        const current = workingSet[i];
        const prev = workingSet[i - 1];

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
    
    // Оптимизация: Берем только последние period свечей, чтобы избежать маппинга 1500 элементов
    const slice = candles.slice(-period);
    
    // Формируем массив Basis (H+L)/2
    const basisArray = slice.map(c => (c.high + c.low) / 2);
    
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
        // ВНИМАНИЕ (Оптимизация): Срезаем только необходимые свечи (atrPeriod + 1), чтобы избежать 
        // копирования массива из 1500+ элементов десятки раз в цикле.
        const sliceLength = atrPeriod + 1;
        const startIdx = Math.max(0, i - sliceLength);
        const slice = candles.slice(startIdx, i);
        
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