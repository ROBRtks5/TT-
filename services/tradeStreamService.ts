import { getOrderState } from './tInvestService';
import { setApiThrottle } from './tInvestApi';
import * as debugService from './debugService';
const { logSystem } = debugService;

export type OrderFillEvent = {
    orderId: string;
    figi: string;
    direction: string;
    price: number;
    quantity: number;
    isPartial: boolean;
};

type FillCallback = (event: OrderFillEvent) => void;

class TradeStreamManager {
    private watchedOrders: Set<string> = new Set();
    private partiallyFilledOrders: Map<string, number> = new Map(); // orderId -> last known filled qty
    private isRunning: boolean = false;
    private onFillCallback: FillCallback | null = null;
    private pollIntervalMs: number = 1000;

    constructor() {}

    public setOnFillCallback(cb: FillCallback) {
        this.onFillCallback = cb;
    }

    public watchOrder(orderId: string) {
        this.watchedOrders.add(orderId);
        if (!this.isRunning) {
            this.start();
        }
    }

    public unwatchOrder(orderId: string) {
        this.watchedOrders.delete(orderId);
        this.partiallyFilledOrders.delete(orderId);
        if (this.watchedOrders.size === 0) {
            this.stop();
        }
    }

    public async startWarmup() {
        debugService.logSystem('TradeStream', 'Starting COLD WARMUP phase (Slow API requests)...');
        setApiThrottle(1000); // 1 request per second
        
        // Simulate a warmup period (e.g., 10 seconds)
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        debugService.logSystem('TradeStream', 'Warmup complete. Accelerating to operational speeds.');
        setApiThrottle(333); // Normal 3 requests per second
    }

    public start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.pollLoop();
    }

    public stop() {
        this.isRunning = false;
    }

    private async pollLoop() {
        while (this.isRunning) {
            if (this.watchedOrders.size === 0) {
                await new Promise(r => setTimeout(r, this.pollIntervalMs));
                continue;
            }

            // Copy to avoid mutation issues during iteration
            const ordersToCheck = Array.from(this.watchedOrders);

            for (const orderId of ordersToCheck) {
                if (!this.isRunning) break;

                try {
                    const state = await getOrderState(orderId);
                    const status = state.executionReportStatus || state.execution_report_status;

                    if (status === 'EXECUTION_REPORT_STATUS_FILL') {
                        // Order was fully filled!
                        this.unwatchOrder(orderId);
                        
                        if (this.onFillCallback) {
                            const priceObj = state.averagePositionPrice || state.initialSecurityPrice;
                            const price = priceObj ? (parseInt(priceObj.units || '0', 10) + (priceObj.nano || 0) / 1e9) : 0;
                            const qty = parseInt(state.lotsExecuted || '0', 10);
                            
                            // Check if we previously notified about partials for this order
                            const prevQty = this.partiallyFilledOrders.get(orderId) || 0;
                            const deltaQty = qty - prevQty;

                            if (deltaQty > 0) { // Only notify if new volume was filled
                                this.onFillCallback({
                                    orderId,
                                    figi: state.figi,
                                    direction: state.direction,
                                    price,
                                    quantity: deltaQty, // Use delta
                                    isPartial: false
                                });
                            }
                        }
                    } else if (status === 'EXECUTION_REPORT_STATUS_PARTIALLYFILL') {
                        if (this.onFillCallback) {
                            const priceObj = state.averagePositionPrice || state.initialSecurityPrice;
                            const price = priceObj ? (parseInt(priceObj.units || '0', 10) + (priceObj.nano || 0) / 1e9) : 0;
                            const qty = parseInt(state.lotsExecuted || '0', 10);
                            
                            const prevQty = this.partiallyFilledOrders.get(orderId) || 0;
                            const deltaQty = qty - prevQty;

                            if (deltaQty > 0) {
                                this.partiallyFilledOrders.set(orderId, qty);
                                this.onFillCallback({
                                    orderId,
                                    figi: state.figi,
                                    direction: state.direction,
                                    price,
                                    quantity: deltaQty, // Notify ONLY the newly filled volume
                                    isPartial: true
                                });
                            }
                        }
                    } else if (
                        status === 'EXECUTION_REPORT_STATUS_CANCELLED' || 
                        status === 'EXECUTION_REPORT_STATUS_REJECTED'
                    ) {
                        // Order is dead, stop watching
                        this.unwatchOrder(orderId);
                    }
                } catch (e) {
                    // Ignore transient errors, will retry next loop
                }
            }

            // Wait before next round of polling
            await new Promise(r => setTimeout(r, this.pollIntervalMs));
        }
    }
}

export const tradeStreamService = new TradeStreamManager();
