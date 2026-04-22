
/*
 * TITAN WORKER ENTRY POINT
 * This file is compiled by Vite into a separate worker bundle.
 */
import { BotKernel } from './bot-kernel';
import { WorkerCommand, WorkerMessage } from './worker-types';

const ctx: Worker = self as any;

const kernel = new BotKernel((message: WorkerMessage) => {
    ctx.postMessage(message);
});

ctx.onmessage = (event: MessageEvent<WorkerCommand>) => {
    kernel.handleCommand(event.data);
};

// Signal readiness
ctx.postMessage({ type: 'BOOT_STARTED' });
ctx.postMessage({ type: 'WORKER_ALIVE' });
