import {
    appErrorSchema,
    CLIENT_EVENTS,
    FUN_REACTION_WINDOW_MS,
    FUN_REACTIONS,
    FUN_REACTIONS_PER_WINDOW,
    funReactedSchema,
    funReactPayloadSchema,
    roomStateSchema,
    SERVER_EVENTS,
} from '../contracts';

const REACTED = { id: 'reaction-1', fromId: 'p-julia', reaction: '☕', reactedAt: 1_700_000_000_000 };

describe('reactions list', () => {
    it('is closed with exactly thumbs up, thinking and coffee', () => {
        expect(FUN_REACTIONS).toEqual(['👍', '🤔', '☕']);
    });
});

describe('fun:react', () => {
    it.each(FUN_REACTIONS)('accepts %s', (reaction) => {
        expect(funReactPayloadSchema.parse({ reaction })).toEqual({ reaction });
        expect(CLIENT_EVENTS['fun:react'].payload).toBe(funReactPayloadSchema);
    });

    it.each(['🎉', '', 'thumbs_up', '👍👍', 1])('rejects the reaction %p', (reaction) => {
        expect(funReactPayloadSchema.safeParse({ reaction }).success).toBe(false);
    });

    it('answers the limit with the waiting time', () => {
        const error = { code: 'rate_limited', retryAfterMs: 900 };
        expect(appErrorSchema.parse(error)).toEqual(error);
    });

    it('has limit constants', () => {
        expect(FUN_REACTIONS_PER_WINDOW).toBe(5);
        expect(FUN_REACTION_WINDOW_MS).toBe(10_000);
    });
});

describe('fun:reacted', () => {
    it('reaches the whole table with who reacted and which reaction', () => {
        expect(funReactedSchema.parse(REACTED)).toEqual(REACTED);
        expect(SERVER_EVENTS['fun:reacted']).toBe(funReactedSchema);
    });

    it.each(['fromId', 'reaction'])('requires %s', (field) => {
        expect(funReactedSchema.safeParse({ ...REACTED, [field]: undefined }).success).toBe(false);
    });

    it('rejects a reaction outside the list', () => {
        expect(funReactedSchema.safeParse({ ...REACTED, reaction: '🎉' }).success).toBe(false);
    });
});

describe('room:state', () => {
    it('has no reaction field', () => {
        expect(Object.keys(roomStateSchema.shape).filter((key) => /reaction/i.test(key))).toEqual([]);
    });
});
