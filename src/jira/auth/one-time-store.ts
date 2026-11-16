import { createHash, randomBytes } from 'node:crypto';
import { SECRET_TOKEN_BYTES } from '../../contracts';
import { Clock } from './jira-auth.tokens';

export interface OneTimeStoreOptions {
    ttlMs: number;
    maxEntries: number;
    clock: Clock;
}

interface Entry<T> {
    value: T;
    expiresAt: number;
}

export class OneTimeStore<T> {
    private readonly entries = new Map<string, Entry<T>>();

    constructor(private readonly options: OneTimeStoreOptions) {}

    get size(): number {
        return this.entries.size;
    }

    put(value: T): string | undefined {
        if (this.entries.size >= this.options.maxEntries) {
            this.sweep();
        }
        if (this.entries.size >= this.options.maxEntries) {
            return undefined;
        }
        const token = randomBytes(SECRET_TOKEN_BYTES).toString('base64url');
        this.entries.set(OneTimeStore.lookupKey(token), {
            value,
            expiresAt: this.options.clock() + this.options.ttlMs,
        });
        return token;
    }

    take(token: string): T | undefined {
        const key = OneTimeStore.lookupKey(token);
        const entry = this.entries.get(key);
        if (!entry) {
            return undefined;
        }
        this.entries.delete(key);
        return entry.expiresAt > this.options.clock() ? entry.value : undefined;
    }

    sweep(): void {
        const now = this.options.clock();
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now) {
                this.entries.delete(key);
            }
        }
    }

    private static lookupKey(token: string): string {
        return createHash('sha256').update(token).digest('base64url');
    }
}
