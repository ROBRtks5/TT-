
import { ChartDataPoint, InstrumentDetails } from '../types';

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
