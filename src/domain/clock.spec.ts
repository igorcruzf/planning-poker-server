import { SystemClock } from './clock';
import { FakeClock } from './testing/fake-clock';

describe('FakeClock', () => {
    it('advances only when told to', () => {
        const clock = new FakeClock(1000);
        expect(clock.now()).toBe(1000);
        clock.advance(500);
        expect(clock.now()).toBe(1500);
    });
});

describe('SystemClock', () => {
    it('returns epoch milliseconds', () => {
        expect(Number.isInteger(new SystemClock().now())).toBe(true);
    });
});
