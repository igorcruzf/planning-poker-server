import {
    appErrorSchema,
    CLIENT_EVENTS,
    FUN_SEED_MAX,
    FUN_THROW_WINDOW_MS,
    FUN_THROWS_PER_WINDOW,
    funThrownSchema,
    funThrowPayloadSchema,
    funUmbrellaPayloadSchema,
    SERVER_EVENTS,
} from '../contracts';

const THROWN = {
    id: 'throw-1',
    seed: 1_234_567,
    fromId: 'p-igor',
    targetId: 'p-bruno',
    blockedByUmbrella: true,
    thrownAt: 1_700_000_000_000,
};

describe('fun:throw', () => {
    it('targets the seat of another participant, the Kiro included', () => {
        expect(funThrowPayloadSchema.parse({ targetId: 'p-kiro' })).toEqual({ targetId: 'p-kiro' });
        expect(CLIENT_EVENTS['fun:throw'].payload).toBe(funThrowPayloadSchema);
    });

    it('limits each person to 3 paper balls every 5 seconds', () => {
        expect(FUN_THROWS_PER_WINDOW).toBe(3);
        expect(FUN_THROW_WINDOW_MS).toBe(5000);
    });

    it('answers the limit with the waiting time for the warning', () => {
        const error = { code: 'rate_limited', retryAfterMs: 1800 };

        expect(appErrorSchema.parse(error)).toEqual(error);
    });
});

describe('fun:thrown', () => {
    it('reaches the whole table with the seed, who threw, the target and the umbrella hit', () => {
        expect(funThrownSchema.parse(THROWN)).toEqual(THROWN);
        expect(SERVER_EVENTS['fun:thrown']).toBe(funThrownSchema);
    });

    it.each(['seed', 'blockedByUmbrella'])('requires %s', (field) => {
        expect(funThrownSchema.safeParse({ ...THROWN, [field]: undefined }).success).toBe(false);
    });

    it.each([-1, 1.5, FUN_SEED_MAX + 1])('rejects the seed %p', (seed) => {
        expect(funThrownSchema.safeParse({ ...THROWN, seed }).success).toBe(false);
    });

    it('accepts any unsigned 32 bit seed', () => {
        expect(FUN_SEED_MAX).toBe(0xffffffff);
        expect(funThrownSchema.safeParse({ ...THROWN, seed: FUN_SEED_MAX }).success).toBe(true);
    });
});

describe('fun:umbrella', () => {
    it.each([true, false])('turns the own umbrella %p', (enabled) => {
        expect(funUmbrellaPayloadSchema.parse({ enabled })).toEqual({ enabled });
    });
});
