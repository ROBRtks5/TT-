
/**
 * TITAN TRADING BOT - DATABASE MANAGER (PROTOCOL EXODUS)
 * ---------------------------------------------------------
 * @module services/databaseService.ts
 * @version 2.0.0 (STORAGE ABSTRACTION)
 * @phase Phase 1: Exodus Prep
 * @description
 * Абстрактный слой управления хранилищем.
 * Позволяет подменять IndexedDB (Browser) на Native File Storage (Android)
 * без изменения бизнес-логики.
 * ---------------------------------------------------------
 */

// --- INTERFACE DEFINITION ---
export interface IStorageProvider {
    name: string;
    init(): Promise<void>;
    getItem<T>(key: string): Promise<T | null>;
    setItem(key: string, value: any): Promise<void>;
    setMany(items: Record<string, any>): Promise<void>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
}

// --- CONSTANTS ---
const DB_NAME = 'TITAN_DB';
const DB_VERSION = 1;
const STORE_NAME = 'vault_objects';
const DB_TIMEOUT_MS = 3000;

// --- UTILS ---
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`⏳ STORAGE TIMEOUT: ${operationName} exceeded ${timeoutMs}ms`));
        }, timeoutMs);

        promise
            .then((value) => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch((err) => {
                clearTimeout(timer);
                reject(err);
            });
    });
};

// --- IMPLEMENTATION: BROWSER INDEXED DB ---
class IndexedDBStorageProvider implements IStorageProvider {
    public name = "IndexedDB (Browser)";
    private dbInstance: IDBDatabase | null = null;

    public async init(): Promise<void> {
        if (this.dbInstance) return;
        this.dbInstance = await this.openDB();
    }

    private openDB(): Promise<IDBDatabase> {
        const openLogic = new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => {
                resolve((event.target as IDBOpenDBRequest).result);
            };

            request.onerror = (event) => {
                reject((event.target as IDBOpenDBRequest).error);
            };

            request.onblocked = () => {
                console.warn("[Storage] IndexedDB Blocked (Tab conflict).");
            };
        });

        return withTimeout(openLogic, DB_TIMEOUT_MS, 'OPEN_DB');
    }

    private async getDB(): Promise<IDBDatabase> {
        if (!this.dbInstance) {
            await this.init();
        }
        return this.dbInstance!;
    }

    public async getItem<T>(key: string): Promise<T | null> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(key);

            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.value : null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    public async setItem(key: string, value: any): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put({ key, value });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    public async setMany(items: Record<string, any>): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            transaction.onerror = () => reject(transaction.error);
            transaction.oncomplete = () => resolve();

            Object.entries(items).forEach(([key, value]) => {
                store.put({ key, value });
            });
        });
    }

    public async removeItem(key: string): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    public async clear(): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

// --- MANAGER (SINGLETON) ---
class StorageManager {
    private provider: IStorageProvider;

    constructor() {
        // Default to Browser IDB
        this.provider = new IndexedDBStorageProvider();
    }

    public setProvider(newProvider: IStorageProvider) {
        console.log(`[StorageManager] Switching provider to: ${newProvider.name}`);
        this.provider = newProvider;
    }

    public getProvider(): IStorageProvider {
        return this.provider;
    }
}

const manager = new StorageManager();

// --- PUBLIC FACADE (MATCHES OLD API) ---

export const initStorage = async () => {
    await manager.getProvider().init();
};

export const getItem = async <T>(key: string): Promise<T | null> => {
    return manager.getProvider().getItem<T>(key);
};

export const setItem = async (key: string, value: any): Promise<void> => {
    return manager.getProvider().setItem(key, value);
};

export const setMany = async (items: Record<string, any>): Promise<void> => {
    return manager.getProvider().setMany(items);
};

export const removeItem = async (key: string): Promise<void> => {
    return manager.getProvider().removeItem(key);
};

export const clearDB = async (): Promise<void> => {
    return manager.getProvider().clear();
};

export const getCurrentProviderName = (): string => {
    return manager.getProvider().name;
};
