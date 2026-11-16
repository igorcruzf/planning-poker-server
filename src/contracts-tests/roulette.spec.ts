import {
    CLIENT_EVENTS,
    ROULETTE_MAX_NAMES,
    ROULETTE_NAME_MAX_LENGTH,
    rouletteModeSchema,
    rouletteSpinPayloadSchema,
    rouletteSpunSchema,
    SERVER_EVENTS,
} from '../contracts';

const TEAM = ['Ana', 'Bruno', 'Carla', 'Diego'];

describe('roulette:spin', () => {
    it('draws who leads or the speaking order', () => {
        expect(rouletteModeSchema.options).toEqual(['leader', 'speaking_order']);
    });

    it('carries the browser list, who is absent and who was already drawn', () => {
        const payload = { mode: 'leader', names: TEAM, absent: ['Diego'], alreadyDrawn: ['Bruno', 'Ana'] };

        expect(rouletteSpinPayloadSchema.parse(payload)).toEqual(payload);
        expect(CLIENT_EVENTS['roulette:spin'].payload).toBe(rouletteSpinPayloadSchema);
    });

    it('starts with nobody absent and nobody drawn', () => {
        expect(rouletteSpinPayloadSchema.parse({ mode: 'speaking_order', names: TEAM })).toEqual({
            mode: 'speaking_order',
            names: TEAM,
            absent: [],
            alreadyDrawn: [],
        });
    });

    it.each([ROULETTE_MAX_NAMES, 1])('accepts %i names', (count) => {
        const names = Array.from({ length: count }, (_, index) => `Pessoa ${index}`);

        expect(rouletteSpinPayloadSchema.safeParse({ mode: 'leader', names }).success).toBe(true);
    });

    it.each([
        ['no names', { names: [] }],
        ['too many names', { names: Array.from({ length: ROULETTE_MAX_NAMES + 1 }, (_, index) => `P${index}`) }],
        ['a name too long', { names: ['a'.repeat(ROULETTE_NAME_MAX_LENGTH + 1)] }],
        ['a repeated name', { names: ['Ana', 'Ana'] }],
        ['an absent name out of the list', { names: TEAM, absent: ['Zeca'] }],
        ['a drawn name out of the list', { names: TEAM, alreadyDrawn: ['Zeca'] }],
        ['a name drawn twice', { names: TEAM, alreadyDrawn: ['Ana', 'Ana'] }],
        ['everybody absent', { names: TEAM, absent: TEAM }],
        ['an unknown mode', { mode: 'casino', names: TEAM }],
    ])('rejects %s', (_case, change) => {
        expect(rouletteSpinPayloadSchema.safeParse({ mode: 'leader', ...change }).success).toBe(false);
    });

    it('keeps names up to 30 characters', () => {
        expect(ROULETTE_NAME_MAX_LENGTH).toBe(30);
    });
});

describe('roulette:spun', () => {
    it('brings the leader the animation lands on', () => {
        const spun = { mode: 'leader', winner: 'Carla', cycleRestarted: false };

        expect(rouletteSpunSchema.parse(spun)).toEqual(spun);
        expect(SERVER_EVENTS['roulette:spun']).toBe(rouletteSpunSchema);
    });

    it('brings the full speaking order', () => {
        const spun = { mode: 'speaking_order', order: ['Carla', 'Ana', 'Bruno'] };

        expect(rouletteSpunSchema.parse(spun)).toEqual(spun);
    });

    it.each([
        { mode: 'leader', cycleRestarted: false },
        { mode: 'speaking_order', winner: 'Ana' },
    ])('rejects %o without the drawn result', (spun) => {
        expect(rouletteSpunSchema.safeParse(spun).success).toBe(false);
    });
});
