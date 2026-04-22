
/**
 * TITAN TRADING BOT - TECHNICAL MATH
 * ---------------------------------------------------------
 * @module utils/technicalIndicators.ts
 * @version 5.58.0 (HARDENED)
 * @phase Centaur Protocol
 * @last-updated 2025-12-14
 * @description
 * Библиотека математических функций для расчета индикаторов.
 * UPD 5.58.0: Added NaN guards to prevent state corruption.
 * ---------------------------------------------------------
 */

import { ChartDataPoint } from '../types';

const safeFloat = (val: number | null | undefined): number | null => {
    if (val === null || val === undefined) return null;
    if (Number.isNaN(val) || !Number.isFinite(val)) return null;
    return val;
};

export const calculateSMA = (data: number[], period: number): number | null => {
  if (data.length < period) {
    return null;
  }
  const sum = data.slice(-period).reduce((acc, val) => acc + val, 0);
  return safeFloat(sum / period);
};

/**
 * Calculates RSI using the standard Wilder's Smoothing method.
 */
export const calculateRSI = (data: number[], period: number = 14): number | null => {
  if (data.length <= period) {
    return null;
  }
  
  const changes = data.map((_, i) => i > 0 ? data[i] - data[i-1] : 0).slice(1);

  let avgGain = 0;
  let avgLoss = 0;

  // Calculate initial averages
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      avgGain += changes[i];
    } else {
      avgLoss -= changes[i];
    }
  }
  avgGain /= period;
  avgLoss /= period;

  // Smooth the rest
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    let gain = 0;
    let loss = 0;
    if (change > 0) {
        gain = change;
    } else {
        loss = -change;
    }
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) {
    return avgGain === 0 ? 50 : 100; // Stabilize flatline
  }
  
  const rs = avgGain / avgLoss;
  return safeFloat(100 - (100 / (1 + rs)));
};


// ATR calculation
export const calculateATR = (data: ChartDataPoint[], period: number = 14): number | null => {
    if (data.length <= period) {
        return null;
    }

    const trueRanges: number[] = [];
    for (let i = 1; i < data.length; i++) {
        const high = data[i].high;
        const low = data[i].low;
        const prevClose = data[i - 1].price;
        
        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trueRanges.push(tr);
    }

    if (trueRanges.length < period) {
        return null;
    }

    const relevantTRs = trueRanges.slice(-period);
    const sum = relevantTRs.reduce((acc, val) => acc + val, 0);

    return safeFloat(sum / period);
};

export const calculateAverageATR = (data: ChartDataPoint[], period: number, lookback: number): number | null => {
    if (data.length < lookback + period) {
        return null;
    }

    const atrValues: number[] = [];
    for (let i = data.length - lookback; i < data.length; i++) {
        const atr = calculateATR(data.slice(0, i + 1), period);
        if (atr !== null) {
            atrValues.push(atr);
        }
    }

    if (atrValues.length === 0) {
        return null;
    }

    const sum = atrValues.reduce((acc, val) => acc + val, 0);
    return safeFloat(sum / atrValues.length);
};


const calculateEMA = (data: number[], period: number): number[] => {
  const k = 2 / (period + 1);
  const emaArray: number[] = [];
  if (data.length < period) return [];
  
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  emaArray[period - 1] = sum / period;

  for (let i = period; i < data.length; i++) {
    // Basic protection against NaN in input data stream
    const price = safeFloat(data[i]) || emaArray[i-1]; 
    emaArray[i] = (price * k) + (emaArray[i - 1] * (1 - k));
  }
  return emaArray;
};

const wildersSmoothing = (data: number[], period: number): number[] => {
    if (data.length < period) return [];
    const smoothed: number[] = [];
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += data[i];
    }
    smoothed[period - 1] = sum / period;

    for (let i = period; i < data.length; i++) {
        const val = safeFloat(data[i]) || 0;
        smoothed[i] = (smoothed[i - 1] * (period - 1) + val) / period;
    }
    return smoothed;
};


export const calculateADX = (data: ChartDataPoint[], period: number = 14): any | null => {
    if (data.length < period * 2) {
        return null;
    }

    const pDMs: number[] = [];
    const mDMs: number[] = [];
    const trs: number[] = [];

    for (let i = 1; i < data.length; i++) {
        const upMove = data[i].high - data[i - 1].high;
        const downMove = data[i - 1].low - data[i].low;

        pDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
        mDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);

        const tr = Math.max(
            data[i].high - data[i].low,
            Math.abs(data[i].high - data[i - 1].price),
            Math.abs(data[i].low - data[i - 1].price)
        );
        trs.push(tr);
    }

    const smoothedPDM = wildersSmoothing(pDMs, period);
    const smoothedMDM = wildersSmoothing(mDMs, period);
    const smoothedTR = wildersSmoothing(trs, period);
    
    if (smoothedTR.length === 0) return null;

    const pDIs: number[] = [];
    const mDIs: number[] = [];

    for (let i = period - 1; i < smoothedTR.length; i++) {
        const str = smoothedTR[i];
        if (str === 0) {
            pDIs.push(0);
            mDIs.push(0);
        } else {
            pDIs.push(100 * (smoothedPDM[i] / str));
            mDIs.push(100 * (smoothedMDM[i] / str));
        }
    }

    const dxs: number[] = [];
    for (let i = 0; i < pDIs.length; i++) {
        const pdi = pDIs[i];
        const mdi = mDIs[i];
        const sum = pdi + mdi;
        dxs.push(sum === 0 ? 0 : 100 * (Math.abs(pdi - mdi) / sum));
    }

    const adx = wildersSmoothing(dxs, period);
    
    if (adx.length === 0) return null;

    return {
        adx: safeFloat(adx[adx.length - 1]) || 0,
        pdi: safeFloat(pDIs[pDIs.length - 1]) || 0,
        mdi: safeFloat(mDIs[mDIs.length - 1]) || 0,
    };
};


export const calculateMACD = (
  data: number[], 
  fastPeriod: number = 12, 
  slowPeriod: number = 26, 
  signalPeriod: number = 9
): { macdLine: number; signalLine: number; histogram: number } | null => {
  if (data.length < slowPeriod + signalPeriod) {
    return null;
  }

  const emaFast = calculateEMA(data, fastPeriod);
  const emaSlow = calculateEMA(data, slowPeriod);

  const macdLineData = data.map((_, i) => {
    if (i < slowPeriod - 1) return null;
    return emaFast[i] - emaSlow[i];
  }).filter(v => v !== null) as number[];

  const signalLineData = calculateEMA(macdLineData, signalPeriod);
  
  if (macdLineData.length === 0 || signalLineData.length === 0) return null;

  const macdLine = macdLineData[macdLineData.length - 1];
  const signalLine = signalLineData[signalLineData.length - 1];
  const histogram = macdLine - signalLine;

  return { 
      macdLine: safeFloat(macdLine) || 0, 
      signalLine: safeFloat(signalLine) || 0, 
      histogram: safeFloat(histogram) || 0
  };
};

const calculateStdDev = (data: number[], period: number): number => {
    const slice = data.slice(-period);
    const mean = slice.reduce((acc, val) => acc + val, 0) / period;
    const variance = slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
    return Math.sqrt(variance);
}

export const calculateBollingerBands = (
  data: number[], 
  period: number = 20, 
  stdDevMultiplier: number = 2
): { upper: number; middle: number; lower: number } | null => {
  if (data.length < period) {
    return null;
  }

  const middle = calculateSMA(data, period);
  if (middle === null) return null;
  
  const stdDev = calculateStdDev(data, period);
  
  const upper = middle + (stdDev * stdDevMultiplier);
  const lower = middle - (stdDev * stdDevMultiplier);

  return { 
      upper: safeFloat(upper) || middle, 
      middle: safeFloat(middle) || middle, 
      lower: safeFloat(lower) || middle 
  };
};

export const calculateVolumeMetrics = (data: ChartDataPoint[], period: number): { volume: number; avgVolume: number; } | null => {
    if (data.length < period) {
        return null;
    }
    const lastVolume = data[data.length - 1].volume;
    const relevantVolumes = data.slice(-period).map(d => d.volume);
    const sum = relevantVolumes.reduce((acc, val) => acc + val, 0);
    const avgVolume = sum / period;

    return { 
        volume: safeFloat(lastVolume) || 0, 
        avgVolume: safeFloat(avgVolume) || 0 
    };
};

export const calculateOBV = (data: ChartDataPoint[]): number | null => {
    if (data.length < 2) {
        return null;
    }

    let obv = 0;
    for (let i = 1; i < data.length; i++) {
        const current = data[i];
        const previous = data[i-1];
        if (current.price > previous.price) {
            obv += current.volume;
        } else if (current.price < previous.price) {
            obv -= current.volume;
        }
    }
    return safeFloat(obv);
};

export const calculateCorrelation = (dataX: number[], dataY: number[]): number | null => {
    if (dataX.length !== dataY.length || dataX.length < 2) {
        return null;
    }

    const n = dataX.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

    for (let i = 0; i < n; i++) {
        const x = dataX[i];
        const y = dataY[i];
        
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x * x;
        sumY2 += y * y;
    }

    const numerator = (n * sumXY) - (sumX * sumY);
    const denominator = Math.sqrt(((n * sumX2) - (sumX * sumX)) * ((n * sumY2) - (sumY * sumY)));

    if (denominator === 0) return 0;

    return safeFloat(numerator / denominator);
};

export const calculateMomentum = (data: number[], period: number): number | null => {
    if (data.length <= period) return null;
    
    const currentPrice = data[data.length - 1];
    const pastPrice = data[data.length - 1 - period];
    
    if (pastPrice === 0) return 0;
    
    return safeFloat(((currentPrice - pastPrice) / pastPrice) * 100);
};

export const findKeyStructuralPoints = (
    data: ChartDataPoint[],
    lookback: number = 100,
    n: number = 3,
    window: number = 5 
): { peaks: number[]; troughs: number[] } => {
    if (data.length < lookback || data.length < (window * 2 + 1)) {
        return { peaks: [], troughs: [] };
    }

    const relevantData = data.slice(-lookback);
    const peaks: number[] = [];
    const troughs: number[] = [];

    const GAP_THRESHOLD_MS = 4 * 60 * 60 * 1000; 

    for (let i = window; i < relevantData.length - window; i++) {
        let hasGapInWindow = false;
        for (let k = i - window; k < i + window; k++) {
            if (relevantData[k + 1].time - relevantData[k].time > GAP_THRESHOLD_MS) {
                hasGapInWindow = true;
                break;
            }
        }
        if (hasGapInWindow) continue;

        let isPeak = true;
        let isTrough = true;

        for (let j = 1; j <= window; j++) {
            if (relevantData[i].high <= relevantData[i - j].high || relevantData[i].high <= relevantData[i + j].high) {
                isPeak = false;
            }
            if (relevantData[i].low >= relevantData[i - j].low || relevantData[i].low >= relevantData[i + j].low) {
                isTrough = false;
            }
        }
        
        if (isPeak) {
            peaks.push(relevantData[i].high);
        }
        if (isTrough) {
            troughs.push(relevantData[i].low);
        }
    }
    
    const filterNoise = (points: number[]): number[] => {
        if(points.length < 2) return points;
        const filtered = [points[0]];
        for(let i = 1; i < points.length; i++){
            const lastPoint = filtered[filtered.length - 1];
            if(Math.abs(points[i] - lastPoint) / lastPoint > 0.002) { 
                filtered.push(points[i]);
            }
        }
        return filtered;
    }

    return {
        peaks: filterNoise(peaks).slice(-n).map(p => parseFloat(p.toFixed(2))),
        troughs: filterNoise(troughs).slice(-n).map(t => parseFloat(t.toFixed(2))),
    };
};

export const calculateIntradayVWAP = (data: ChartDataPoint[]): (number | null)[] => {
    if (data.length === 0) return [];

    const vwapValues: (number | null)[] = new Array(data.length).fill(null);
    
    let cumPV = 0;
    let cumVol = 0;
    let currentDay: number | null = null;

    for (let i = 0; i < data.length; i++) {
        const point = data[i];
        const date = new Date(point.time);
        const day = date.getDate(); 

        if (currentDay !== day) {
            cumPV = 0;
            cumVol = 0;
            currentDay = day;
        }

        const typicalPrice = (point.high + point.low + point.price) / 3;
        const vol = point.volume;

        cumPV += typicalPrice * vol;
        cumVol += vol;

        if (cumVol > 0) {
            vwapValues[i] = safeFloat(cumPV / cumVol);
        } else {
            vwapValues[i] = safeFloat(point.price); 
        }
    }

    return vwapValues;
};

export const calculateRollingVWAP = (data: ChartDataPoint[], window: number): (number | null)[] => {
    const len = data.length;
    const vwapValues: (number | null)[] = new Array(len).fill(null);
    
    if (len < window) return vwapValues;

    let currentPV = 0;
    let currentVol = 0;

    // Initial window
    for (let i = 0; i < window; i++) {
        const p = data[i];
        const typicalPrice = (p.high + p.low + p.price) / 3;
        currentPV += typicalPrice * p.volume;
        currentVol += p.volume;
        
        if (i === window - 1) {
             vwapValues[i] = currentVol > 0 ? safeFloat(currentPV / currentVol) : safeFloat(p.price);
        }
    }

    // Slide
    for (let i = window; i < len; i++) {
        const newPoint = data[i];
        const oldPoint = data[i - window];

        const newTypical = (newPoint.high + newPoint.low + newPoint.price) / 3;
        const oldTypical = (oldPoint.high + oldPoint.low + oldPoint.price) / 3;

        currentPV += (newTypical * newPoint.volume) - (oldTypical * oldPoint.volume);
        currentVol += (newPoint.volume - oldPoint.volume);

        vwapValues[i] = currentVol > 0 ? safeFloat(currentPV / currentVol) : safeFloat(newPoint.price);
    }

    return vwapValues;
};
