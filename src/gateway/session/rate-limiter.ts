import { Clock } from '../../domain/clock';

export interface RateWindow {
    readonly limit: number;
    readonly windowMs: number;
}

interface Counter {
    count: number;
    endsAt: number;
}

const PURGE_THRESHOLD = 1_000;

export class RateLimiter {
    private readonly counters = new Map<string, Counter>();

    constructor(
        private readonly window: RateWindow,
        private readonly clock: Clock,
    ) {}

    get size(): number {
        return this.counters.size;
    }

    consume(key: string): number | null {
        const now = this.clock.now();
        this.purgeExpired(now);
        const counter = this.currentCounter(key, now);
        if (counter.count >= this.window.limit) return counter.endsAt - now;
        counter.count += 1;
        return null;
    }

    release(key: string): void {
        this.counters.delete(key);
    }

    private currentCounter(key: string, now: number): Counter {
        const existing = this.counters.get(key);
        if (existing && existing.endsAt > now) return existing;
        const created = { count: 0, endsAt: now + this.window.windowMs };
        this.counters.set(key, created);
        return created;
    }

    private purgeExpired(now: number): void {
        if (this.counters.size < PURGE_THRESHOLD) return;
        for (const [key, counter] of this.counters) {
            if (counter.endsAt <= now) this.counters.delete(key);
        }
    }
}
