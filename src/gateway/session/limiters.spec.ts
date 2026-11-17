import { FakeClock } from '../../domain/testing/fake-clock';
import { ConnectionLimiter } from './connection-limiter';
import { EventRateLimiter } from './event-rate-limiter';
import { ADDRESS_ENTRY_LIMIT, MAX_CONNECTIONS_PER_ADDRESS, SOCKET_EVENT_LIMIT } from './limits';

describe('ConnectionLimiter', () => {
    it('is full after the maximum of sockets of one address', () => {
        const limiter = new ConnectionLimiter();
        Array.from({ length: MAX_CONNECTIONS_PER_ADDRESS }, (_, index) => limiter.add(`s${index}`, 'ip'));
        expect(limiter.isFull('ip')).toBe(true);
        expect(limiter.isFull('other')).toBe(false);
    });

    it('opens a vacancy when a socket leaves, once', () => {
        const limiter = new ConnectionLimiter();
        Array.from({ length: MAX_CONNECTIONS_PER_ADDRESS }, (_, index) => limiter.add(`s${index}`, 'ip'));
        limiter.remove('s0');
        limiter.remove('s0');
        expect(limiter.isFull('ip')).toBe(false);
        limiter.add('late', 'ip');
        expect(limiter.isFull('ip')).toBe(true);
    });

    it('counts a socket only once', () => {
        const limiter = new ConnectionLimiter();
        Array.from({ length: MAX_CONNECTIONS_PER_ADDRESS }, () => limiter.add('same', 'ip'));
        expect(limiter.isFull('ip')).toBe(false);
    });
});

describe('EventRateLimiter', () => {
    it('blocks a socket that goes over its limit and tells when to retry', () => {
        const limiter = new EventRateLimiter(new FakeClock());
        Array.from({ length: SOCKET_EVENT_LIMIT.limit }, () => expect(limiter.check('round:vote', 's1', 'ip')).toBeNull());
        expect(limiter.check('round:vote', 's1', 'ip')).toBe(SOCKET_EVENT_LIMIT.windowMs);
        expect(limiter.check('round:vote', 's2', 'ip')).toBeNull();
    });

    it('applies the stricter entry limit to create and join per address', () => {
        const limiter = new EventRateLimiter(new FakeClock());
        Array.from({ length: ADDRESS_ENTRY_LIMIT.limit }, (_, index) =>
            expect(limiter.check('room:join', `s${index}`, 'ip')).toBeNull(),
        );
        expect(limiter.check('room:join', 'fresh', 'ip')).toBe(ADDRESS_ENTRY_LIMIT.windowMs);
        expect(limiter.check('room:create', 'fresh2', 'ip')).not.toBeNull();
        expect(limiter.check('round:vote', 'fresh3', 'ip')).toBeNull();
    });

    it('lets a socket start over after release', () => {
        const limiter = new EventRateLimiter(new FakeClock());
        Array.from({ length: SOCKET_EVENT_LIMIT.limit + 1 }, () => limiter.check('round:vote', 's1', 'ip'));
        limiter.release('s1');
        expect(limiter.check('round:vote', 's1', 'ip')).toBeNull();
    });
});
