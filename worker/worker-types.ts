
import { BotState, KernelStatus, LogEntry, SystemConfig } from '../types';

export type PartialStatePayload = Partial<BotState>;

export type WorkerCommand =
  | { type: 'START_BOT' }
  | { type: 'STOP_BOT' }
  | { type: 'SAVE_API_KEY'; payload: { apiKey: string; newsApiKey?: string } } 
  | { type: 'SET_MANUAL_LOT_SIZE'; payload: number }
  | { type: 'SET_LEVERAGE_MULTIPLIER'; payload: number }
  | { type: 'RESET_MEMORY' }
  | { type: 'IMPORT_VAULT'; payload: string }
  | { type: 'WAKE_UP' } 
  | { type: 'EMERGENCY_API_RESET' } 
  | { type: 'FORCE_CLOSE_POSITION' } 
  | { type: 'SET_INSTRUMENT_TICKER'; payload: string } 
  | { type: 'RUN_OFFLINE_SIMULATION' } 
  | { type: 'IMMEDIATE_STATE_SAVE'; payload: BotState } 
  | { type: 'UPDATE_BIOS_SETTINGS'; payload: Partial<SystemConfig> } 
  | { type: 'AI_RPC_RESPONSE'; payload: { id: string; result?: any; error?: string } }; 

export type WorkerMessage =
  | { type: 'BOOT_STARTED' }
  | { type: 'WORKER_ALIVE' }
  | { type: 'HEARTBEAT' } // KEEP-ALIVE SIGNAL
  | { type: 'AI_RPC_REQUEST'; payload: { id: string; params: any; functionName: string } }
  | { type: 'AI_RPC_RESPONSE'; payload: { id: string; result?: any; error?: string } }
  | { type: 'IMMEDIATE_STATE_SAVE'; payload: BotState }
  | { type: 'REPLACE_STATE'; payload: BotState }
  | { type: 'PARTIAL_STATE_UPDATE'; payload: PartialStatePayload }
  | { type: 'LOG'; payload: LogEntry }
  | { type: 'SEND_NOTIFICATION'; payload: { title: string; body?: string } }
  | { type: 'KERNEL_STATUS_UPDATE'; payload: { status: KernelStatus; error: string | null } };
