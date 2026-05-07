import { getOrderState, mapToNumber } from './tInvestService';
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

            try {
                // OPTIMIZATION: Fetch all active orders instead of querying individually (prevents rate limits)
                const { getAccountId, makeApiRequest } = await import('./tInvestApi');
                const accountId = await getAccountId();
                const res = await makeApiRequest<any>('tinkoff.public.invest.api.contract.v1.OrdersService/GetOrders', 'POST', { accountId });
                const activeOrders = res.orders || [];
                
                const activeOrderMap = new Map<string, any>();
                for (const o of activeOrders) {
                    const id = o.orderId || o.order_id;
                    activeOrderMap.set(id, o);
                }

                // Copy to avoid mutation issues during iteration
                const ordersToCheck = Array.from(this.watchedOrders);
                const terminalCandidates = [];

                for (const orderId of ordersToCheck) {
                    if (!this.isRunning) break;

                    const activeOrder = activeOrderMap.get(orderId);

                    if (activeOrder) {
                        const status = activeOrder.executionReportStatus || activeOrder.execution_report_status;
                        
                        if (status === 'EXECUTION_REPORT_STATUS_PARTIALLYFILL') {
                            if (this.onFillCallback) {
                                const priceObj = activeOrder.averagePositionPrice || activeOrder.initialSecurityPrice || activeOrder.initial_security_price;
                                const price = mapToNumber(priceObj);
                                const qty = parseInt(activeOrder.lotsExecuted || activeOrder.lots_executed || '0', 10);
                                
                                const prevQty = this.partiallyFilledOrders.get(orderId) || 0;
                                const deltaQty = qty - prevQty;

                                if (deltaQty > 0) {
                                    this.partiallyFilledOrders.set(orderId, qty);
                                    let activeDir = activeOrder.direction;
                                    if (activeDir === 'ORDER_DIRECTION_BUY') activeDir = 'BUY';
                                    if (activeDir === 'ORDER_DIRECTION_SELL') activeDir = 'SELL';

                                    this.onFillCallback({
                                        orderId,
                                        figi: activeOrder.figi,
                                        direction: activeDir,
                                        price,
                                        quantity: deltaQty, // Notify ONLY the newly filled volume
                                        isPartial: true
                                    });
                                }
                            }
                        }
                    } else {
                        // Order is missing from GetOrders, meaning it transitioned to terminal state (FILL, CANCEL, REJECT)
                        // Add to candidates for parallel fetching
                        terminalCandidates.push(orderId);
                    }
                }

                if (terminalCandidates.length > 0 && this.isRunning) {
                    await Promise.allSettled(terminalCandidates.map(async (orderId) => {
                        try {
                            const state = await getOrderState(orderId);
                            const status = state.executionReportStatus || state.execution_report_status;

                            if (status === 'EXECUTION_REPORT_STATUS_FILL') {
                                // Order was fully filled!
                                this.unwatchOrder(orderId);
                                
                                if (this.onFillCallback) {
                                    const priceObj = state.averagePositionPrice || state.initialSecurityPrice;
                                    const price = mapToNumber(priceObj);
                                    const qty = parseInt(state.lotsExecuted || '0', 10);
                                    
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
                    }));
                }
            } catch (e) {
                // If the global GetOrders fails, ignore and try again next loop
            }

            // Wait before next round of polling
            await new Promise(r => setTimeout(r, this.pollIntervalMs));
        }
    }
}

export const tradeStreamService = new TradeStreamManager();
