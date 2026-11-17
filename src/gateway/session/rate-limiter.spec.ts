import { FakeClock } from '../../domain/testing/fake-clock';
import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
    const window = { limit: 3, windowMs: 1_000 };

    it('allows up to the limit inside the window', () => {
        const limiter = new RateLimiter(window, new FakeClock());
        expect([1, 2, 3].map(() => limiter.consume('a'))).toEqual([null, null, null]);
    });

    it('answers how long to wait after the limit', () => {
        const limiter = new RateLimiter(window, new FakeClock());
        [1, 2, 3].forEach(() => limiter.consume('a'));
        expect(limiter.consume('a')).toBe(1_000);
    });

    it('counts the remaining time of the window in retryAfterMs', () => {
        const clock = new FakeClock();
        const limiter = new RateLimiter(window, clock);
        [1, 2, 3].forEach(() => limiter.consume('a'));
        clock.advance(400);
        expect(limiter.consume('a')).toBe(600);
    });

    it('opens a new window when the previous one ends', () => {
        const clock = new FakeClock();
        const limiter = new RateLimiter(window, clock);
        [1, 2, 3, 4].forEach(() => limiter.consume('a'));
        clock.advance(1_000);
        expect(limiter.consume('a')).toBeNull();
    });

    it('keeps one counter per key', () => {
        const limiter = new RateLimiter(window, new FakeClock());
        [1, 2, 3, 4].forEach(() => limiter.consume('a'));
        expect(limiter.consume('b')).toBeNull();
    });

    it('forgets a released key', () => {
        const limiter = new RateLimiter(window, new FakeClock());
        [1, 2, 3, 4].forEach(() => limiter.consume('a'));
        limiter.release('a');
        expect(limiter.consume('a')).toBeNull();
    });

    it('drops expired windows so memory does not grow without bound', () => {
        const clock = new FakeClock();
        const limiter = new RateLimiter(window, clock);
        Array.from({ length: 2_000 }, (_, index) => limiter.consume(`key-${index}`));
        clock.advance(1_000);
        limiter.consume('fresh');
        expect(limiter.size).toBe(1);
    });
});
