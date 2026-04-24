
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
    
    // Naively update 1d using 1m data points for simplicity on live updates
    const d1Points = [...(updated['1d'] || [])];
    if (d1Points.length > 0) {
        const lastD1Idx = d1Points.length - 1;
        const currentD1 = d1Points[lastD1Idx];
        const newDate = new Date(newCandle.time).toISOString().split('T')[0];
        const lastDate = new Date(currentD1.time).toISOString().split('T')[0];

        if (newDate === lastDate) {
            d1Points[lastD1Idx] = {
                ...currentD1,
                high: Math.max(currentD1.high, newCandle.high),
                low: Math.min(currentD1.low, newCandle.low),
                price: newCandle.price // Price serves as Close in this context
            };
        } else {
            d1Points.push({ ...newCandle });
        }
        updated['1d'] = d1Points.slice(-100);
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
    // 1m history
    const from1m = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24h history
    // 1d history - about 90 days (more than 65 needed for nATR)
    const from1d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); 
    
    try {
        const [candles1m, candles1d] = await Promise.all([
            tInvestService.fetchCandles({ figi: instrument.figi }, '1m', from1m, now),
            tInvestService.fetchCandles({ figi: instrument.figi }, '1d', from1d, now)
        ]);
        
        log(`📊 BOOTSTRAP: Загружено ${candles1m.length} (1m) и ${candles1d.length} (1d) свечей.`);
        return { '1m': candles1m, '1d': candles1d };
    } catch (e: any) {
        log(`❌ BOOTSTRAP ERROR: ${e.message}`);
        return { '1m': [], '1d': [] };
    }
};
