import {
    COUNTDOWN_SECONDS_OPTIONS,
    countdownSecondsSchema,
    DEFAULT_DECK,
    DEFAULT_ROOM_SETTINGS,
    roomSettingsInputSchema,
    roomSettingsPatchSchema,
    roomSettingsSchema,
} from '../contracts';

describe('room settings defaults', () => {
    const parsedDefaults = roomSettingsInputSchema.parse({});

    it.each([
        ['deck', DEFAULT_DECK],
        ['specialCards', ['?', 'yakult']],
        ['autoReveal', false],
        ['countdownSeconds', 3],
        ['allowSpectators', true],
        ['allowKiro', false],
        ['kiroCountsAsPlayer', false],
        ['jiraLinked', false],
        ['jiraCommentOnSave', false],
    ] as const)('defaults %s to %p', (setting, expected) => {
        expect(DEFAULT_ROOM_SETTINGS[setting]).toEqual(expected);
        expect(parsedDefaults[setting]).toEqual(expected);
    });

    it('uses the Yakutsk deck by default', () => {
        expect(DEFAULT_ROOM_SETTINGS.deck.presetId).toBe('yakutsk');
    });

    it('fills only the missing settings', () => {
        expect(roomSettingsInputSchema.parse({ autoReveal: true, countdownSeconds: 0 })).toEqual({
            ...DEFAULT_ROOM_SETTINGS,
            autoReveal: true,
            countdownSeconds: 0,
        });
    });

    it('produces a complete settings object', () => {
        expect(roomSettingsSchema.parse(parsedDefaults)).toEqual(DEFAULT_ROOM_SETTINGS);
    });
});

describe('countdown', () => {
    it('offers 0, 3 and 5 seconds', () => {
        expect(COUNTDOWN_SECONDS_OPTIONS).toEqual([0, 3, 5]);
    });

    it.each([0, 3, 5])('accepts %i seconds', (seconds) => {
        expect(countdownSecondsSchema.parse(seconds)).toBe(seconds);
    });

    it.each([4, 1, -3, 3.5, '3'])('rejects %p', (seconds) => {
        expect(countdownSecondsSchema.safeParse(seconds).success).toBe(false);
    });
});

describe('special cards setting', () => {
    it.each([[[]], [['?']], [['yakult']], [['?', 'yakult']]])('accepts %p', (specialCards) => {
        expect(roomSettingsInputSchema.safeParse({ specialCards }).success).toBe(true);
    });

    it.each([[['?', '?']], [['coffee']]])('rejects %p', (specialCards) => {
        expect(roomSettingsInputSchema.safeParse({ specialCards }).success).toBe(false);
    });
});

describe('settings patch', () => {
    it('accepts a single changed setting', () => {
        expect(roomSettingsPatchSchema.parse({ allowKiro: true })).toEqual({ allowKiro: true });
    });

    it('does not fill defaults', () => {
        expect(roomSettingsPatchSchema.parse({ autoReveal: true })).not.toHaveProperty('deck');
    });

    it('rejects an empty patch', () => {
        expect(roomSettingsPatchSchema.safeParse({}).success).toBe(false);
    });
});
