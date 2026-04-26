/**
 * TITAN - Simple async Mutex for blocking state-machine events.
 * Prevents Race Conditions during execution processing.
 */
export class Mutex {
    private mutex: Promise<any> = Promise.resolve();

    /**
     * Locks the mutex and returns a release function.
     * Use like: const release = await mutex.acquire(); ... release();
     */
    acquire(): Promise<() => void> {
        let release: () => void;
        const out = new Promise<() => void>((resolve) => {
            release = () => resolve(undefined as any);
        });
        
        const oldMutex = this.mutex;
        this.mutex = this.mutex.then(() => out);
        
        return new Promise<() => void>((resolve) => {
            oldMutex.then(() => resolve(release));
        });
    }

    /**
     * Executes an async operation with the lock automatically acquired and released.
     */
    async runExclusive<T>(callback: () => Promise<T>): Promise<T> {
        const release = await this.acquire();
        try {
            return await callback();
        } finally {
            release();
        }
    }
}
