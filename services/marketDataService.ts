
import { ChartDataPoint, InstrumentDetails } from '../types';

/**
 * Merges a live candle update into existing chart data arrays.
 */
export const mergeCandleUpdate = (
    currentData: Record<string, ChartDataPoint[]>, 
    newCandle: ChartDataPoint
): Record<string, ChartDataPoint[]> => {
    const updated = { ...currentData };
    const interval = '1m'; // Default for live streams
    const points = [...(updated[interval] || [])];
    
    if (points.length === 0) {
        updated[interval] = [newCandle];
        return updated;
    }
    
    const lastIdx = points.length - 1;
    if (points[lastIdx].time === newCandle.time) {
        points[lastIdx] = newCandle; // Update same minute
    } else {
        points.push(newCandle); // Append new minute
    }
    
    // Cap at 1000 points
    if (points.length > 1000) {
        updated[interval] = points.slice(-1000);
    } else {
        updated[interval] = points;
    }
    
    return updated;
};

/**
 * Initializes chart data on bot startup.
 */
export const fetchBootstrapChartData = async (
    instrument: InstrumentDetails,
    ticker: string,
    tInvestService: any,
    log: (msg: string) => void
): Promise<Record<string, ChartDataPoint[]>> => {
    log(`📊 BOOTSTRAP: Загрузка истории для ${ticker}...`);
    
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24h history
    
    try {
        const candles = await tInvestService.fetchCandles({ figi: instrument.figi }, '1m', from, now);
        log(`📊 BOOTSTRAP: Загружено ${candles.length} свечей.`);
        return { '1m': candles };
    } catch (e: any) {
        log(`❌ BOOTSTRAP ERROR: ${e.message}`);
        return { '1m': [] };
    }
};
