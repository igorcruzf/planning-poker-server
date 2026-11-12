import {
    DEFAULT_ROOM_SETTINGS,
    DISCONNECTED_PLAYER_GRACE_MS,
    participantStateSchema,
    PERSON_NAME_MAX_LENGTH,
    ROOM_CODE_PATTERN,
    ROOM_CODE_PREFIX,
    ROOM_CODE_SUFFIX_ALPHABET,
    ROOM_CODE_SUFFIX_LENGTH,
    ROOM_IDLE_TTL_MS,
    ROOM_LINK_QUERY_PARAM,
    roomCodeSchema,
    roomCreatePayloadSchema,
    roomJoinPayloadSchema,
    roomNameSchema,
    roomSessionSchema,
    SECRET_TOKEN_BYTES,
    sessionTokenSchema,
} from '../contracts';

const TOKEN = 'T'.repeat(43);

describe('room code', () => {
    it('accepts the example of the room link', () => {
        expect(ROOM_LINK_QUERY_PARAM).toBe('mesa');
        expect(roomCodeSchema.parse('yak-7f3k')).toBe('yak-7f3k');
    });

    it('normalizes a code typed in upper case or with spaces', () => {
        expect(roomCodeSchema.parse(' YAK-7F3K ')).toBe('yak-7f3k');
    });

    it('matches the codes the server generates', () => {
        const generated = ROOM_CODE_PREFIX + ROOM_CODE_SUFFIX_ALPHABET.slice(0, ROOM_CODE_SUFFIX_LENGTH);

        expect(ROOM_CODE_SUFFIX_LENGTH).toBe(8);
        expect(new Set(ROOM_CODE_SUFFIX_ALPHABET).size).toBe(32);
        expect(ROOM_CODE_PATTERN.test(generated)).toBe(true);
    });

    it.each(['yak', 'yak-', 'yak-7f3', 'mesa-7f3k', 'yak-7f3k!', 'yak-7f3k-x', `yak-${'a'.repeat(17)}`])(
        'rejects %p',
        (code) => {
            expect(roomCodeSchema.safeParse(code).success).toBe(false);
        },
    );
});

describe('names', () => {
    it.each([1, PERSON_NAME_MAX_LENGTH])('accepts a name with %i characters', (length) => {
        expect(roomNameSchema.safeParse('a'.repeat(length)).success).toBe(true);
        expect(roomJoinPayloadSchema.safeParse({ roomCode: 'yak-7f3k', name: 'a'.repeat(length) }).success).toBe(
            true,
        );
    });

    it.each(['', '   ', 'a'.repeat(31), 'Ana\nBob'])('rejects the name %p', (name) => {
        expect(roomNameSchema.safeParse(name).success).toBe(false);
        expect(roomJoinPayloadSchema.safeParse({ roomCode: 'yak-7f3k', name }).success).toBe(false);
    });

    it('limits names to 30 characters', () => {
        expect(PERSON_NAME_MAX_LENGTH).toBe(30);
    });
});

describe('session token', () => {
    it('is a base64url string of 32 random bytes', () => {
        expect(SECRET_TOKEN_BYTES).toBe(32);
        expect(sessionTokenSchema.safeParse(TOKEN).success).toBe(true);
        expect(sessionTokenSchema.safeParse('T'.repeat(42)).success).toBe(false);
        expect(sessionTokenSchema.safeParse(`${'T'.repeat(42)}=`).success).toBe(false);
    });

    it('comes back only in the create or join answer', () => {
        const session = { roomCode: 'yak-7f3k', participantId: 'p-igor', sessionToken: TOKEN };

        expect(roomSessionSchema.parse(session)).toEqual(session);
    });
});

describe('room:create', () => {
    it('fills the default settings', () => {
        expect(roomCreatePayloadSchema.parse({ roomName: 'Refinamento Yak', participantName: 'Igor' })).toEqual({
            roomName: 'Refinamento Yak',
            participantName: 'Igor',
            settings: DEFAULT_ROOM_SETTINGS,
        });
    });
});

describe('room:join', () => {
    it('joins as a player by default', () => {
        expect(roomJoinPayloadSchema.parse({ roomCode: 'yak-7f3k', name: 'Júlia' })).toEqual({
            roomCode: 'yak-7f3k',
            name: 'Júlia',
            role: 'player',
        });
    });

    it('takes the session token to keep the seat when reconnecting', () => {
        const payload = { roomCode: 'yak-7f3k', name: 'Júlia', role: 'spectator', sessionToken: TOKEN };

        expect(roomJoinPayloadSchema.parse(payload)).toEqual(payload);
    });

    it('never joins as a bot', () => {
        expect(roomJoinPayloadSchema.safeParse({ roomCode: 'yak-7f3k', name: 'Kiro', role: 'bot' }).success).toBe(
            false,
        );
    });
});

describe('participant', () => {
    const human = {
        id: 'p-bruno',
        name: 'Bruno',
        role: 'player',
        isFacilitator: false,
        presence: 'connected',
        hasVoted: true,
        umbrella: true,
    };

    it.each(['player', 'spectator'])('describes a %s', (role) => {
        expect(participantStateSchema.parse({ ...human, role })).toEqual({ ...human, role });
    });

    it('describes a disconnected participant', () => {
        expect(participantStateSchema.parse({ ...human, presence: 'disconnected' }).presence).toBe('disconnected');
    });

    it('describes the bot seat with its owner', () => {
        const bot = { ...human, id: 'p-kiro', name: 'Kiro do Igor', role: 'bot', umbrella: false, ownerId: 'p-igor' };

        expect(participantStateSchema.parse(bot)).toEqual(bot);
        expect(participantStateSchema.safeParse({ ...bot, ownerId: undefined }).success).toBe(false);
    });
});

describe('room timing', () => {
    it('keeps an empty room for 2 hours', () => {
        expect(ROOM_IDLE_TTL_MS).toBe(2 * 60 * 60 * 1000);
    });

    it('counts a disconnected player for 30 seconds', () => {
        expect(DISCONNECTED_PLAYER_GRACE_MS).toBe(30 * 1000);
    });
});
