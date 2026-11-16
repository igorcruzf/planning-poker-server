import { OneTimeStore } from './one-time-store';

describe('OneTimeStore', () => {
    let now: number;
    const createStore = (maxEntries = 3) => new OneTimeStore<{ label: string }>({ ttlMs: 1000, maxEntries, clock: () => now });

    beforeEach(() => {
        now = 10_000;
    });

    it('issues a secret token of 43 base64url characters and returns the value once', () => {
        const store = createStore();
        const token = store.put({ label: 'a' });
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(store.take(token!)).toEqual({ label: 'a' });
        expect(store.take(token!)).toBeUndefined();
    });

    it('issues different tokens', () => {
        const store = createStore();
        expect(store.put({ label: 'a' })).not.toBe(store.put({ label: 'a' }));
    });

    it('returns undefined for unknown tokens', () => {
        expect(createStore().take('unknown')).toBeUndefined();
    });

    it('expires entries at the ttl using the injected clock', () => {
        const store = createStore();
        const token = store.put({ label: 'a' })!;
        now += 999;
        expect(store.take(token)).toEqual({ label: 'a' });
        const expired = store.put({ label: 'b' })!;
        now += 1000;
        expect(store.take(expired)).toBeUndefined();
    });

    it('refuses new entries when full and accepts again after a take', () => {
        const store = createStore(2);
        const first = store.put({ label: '1' })!;
        store.put({ label: '2' });
        expect(store.put({ label: '3' })).toBeUndefined();
        store.take(first);
        expect(store.put({ label: '3' })).toBeDefined();
    });

    it('counts expired entries as free space after a sweep', () => {
        const store = createStore(1);
        store.put({ label: '1' });
        now += 1000;
        store.sweep();
        expect(store.size).toBe(0);
        expect(store.put({ label: '2' })).toBeDefined();
    });

    it('sweeps only expired entries', () => {
        const store = createStore();
        store.put({ label: 'old' });
        now += 600;
        const fresh = store.put({ label: 'fresh' })!;
        now += 600;
        store.sweep();
        expect(store.size).toBe(1);
        expect(store.take(fresh)).toEqual({ label: 'fresh' });
    });
});
