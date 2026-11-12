import { appErrorSchema, DEFAULT_ROOM_SETTINGS, type RoomState, roomStateSchema } from '../contracts';

const TOKEN = 'S'.repeat(43);
const KIRO_RATIONALE = 'Parece grande: mexe em cache e em dois serviços.';

const participants = [
    {
        id: 'p-igor',
        name: 'Igor',
        role: 'player',
        isFacilitator: true,
        presence: 'connected',
        hasVoted: true,
        umbrella: false,
    },
    {
        id: 'p-julia',
        name: 'Júlia',
        role: 'player',
        isFacilitator: false,
        presence: 'disconnected',
        hasVoted: false,
        umbrella: false,
    },
    {
        id: 'p-bruno',
        name: 'Bruno',
        role: 'player',
        isFacilitator: false,
        presence: 'connected',
        hasVoted: true,
        umbrella: true,
    },
    {
        id: 'p-marcos',
        name: 'Marcos',
        role: 'spectator',
        isFacilitator: false,
        presence: 'connected',
        hasVoted: false,
        umbrella: false,
    },
    {
        id: 'p-kiro',
        name: 'Kiro do Igor',
        role: 'bot',
        isFacilitator: false,
        presence: 'connected',
        hasVoted: true,
        umbrella: false,
        ownerId: 'p-igor',
    },
];

const baseState = {
    serverInstanceId: 'srv-boot-1',
    room: { code: 'yak-7f3k', name: 'Refinamento Yak', createdAt: 1_700_000_000_000 },
    settings: DEFAULT_ROOM_SETTINGS,
    participants,
    history: [],
    jira: null,
    self: { participantId: 'p-igor', vote: 'M' },
};

const votingRound = { id: 4, phase: 'voting', issueKey: 'YAK-1234', pendingVoterIds: ['p-julia'] };
const countdownRound = { ...votingRound, phase: 'countdown', revealAt: 1_700_000_003_000, countdownMs: 3000 };
const revealedRound = {
    id: 4,
    phase: 'revealed',
    issueKey: 'YAK-1234',
    revealedAt: 1_700_000_003_000,
    votes: [
        { participantId: 'p-igor', name: 'Igor', value: 'M' },
        { participantId: 'p-bruno', name: 'Bruno', value: 'G' },
    ],
    kiroGuesses: [{ participantId: 'p-kiro', name: 'Kiro do Igor', value: 'G', rationale: KIRO_RATIONALE }],
    finalEstimate: null,
};

const leakyParticipants = participants.map((participant) => ({
    ...participant,
    vote: 'G',
    value: 'G',
    rationale: KIRO_RATIONALE,
    sessionToken: TOKEN,
}));

const leakyRound = (round: object) => ({ ...round, votes: revealedRound.votes, kiroGuesses: revealedRound.kiroGuesses });

const SECRET_KEYS = ['vote', 'votes', 'value', 'rationale', 'kiroGuesses'];

const keysOf = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value.flatMap(keysOf);
    }
    if (value !== null && typeof value === 'object') {
        return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]);
    }
    return [];
};

const expectNoHiddenVotes = (cleanState: object, leakyState: object) => {
    expect(roomStateSchema.safeParse(cleanState).success).toBe(true);
    const result = roomStateSchema.safeParse(leakyState);
    if (!result.success) {
        return;
    }
    const exposed = [...keysOf(result.data.participants), ...keysOf(result.data.round)];
    expect(exposed.filter((key) => SECRET_KEYS.includes(key))).toEqual([]);
    expect(JSON.stringify(result.data)).not.toContain(KIRO_RATIONALE);
};

describe('room:state before the reveal', () => {
    it.each([
        ['voting', votingRound],
        ['countdown', countdownRound],
    ])('drops the vote values of the other participants in the %s phase', (_phase, round) => {
        expectNoHiddenVotes({ ...baseState, round }, { ...baseState, participants: leakyParticipants, round });
    });

    it.each([
        ['voting', votingRound],
        ['countdown', countdownRound],
    ])('drops the votes and the Kiro rationale put in the round in the %s phase', (_phase, round) => {
        expectNoHiddenVotes({ ...baseState, round }, { ...baseState, round: leakyRound(round) });
    });

    it('tells who is still missing a vote (D8)', () => {
        const state = roomStateSchema.parse({ ...baseState, round: votingRound });

        expect(state.round.phase === 'voting' && state.round.pendingVoterIds).toEqual(['p-julia']);
    });

    it('carries the reveal moment of the countdown', () => {
        const state = roomStateSchema.parse({ ...baseState, round: countdownRound });

        expect(state.round).toEqual(countdownRound);
    });

    it('returns the own vote only in the personal field', () => {
        const state = roomStateSchema.parse({ ...baseState, round: votingRound });

        expect(state.self).toEqual({ participantId: 'p-igor', vote: 'M' });
        expect(state.participants.find((participant) => participant.id === 'p-igor')).not.toHaveProperty('vote');
    });

    it('keeps the hasVoted flag without the value', () => {
        const state = roomStateSchema.parse({ ...baseState, participants: leakyParticipants, round: votingRound });

        expect(state.participants.map((participant) => participant.hasVoted)).toEqual([
            true,
            false,
            true,
            false,
            true,
        ]);
    });
});

describe('room:state after the reveal', () => {
    it('carries the votes, the Kiro guess with its rationale and the final estimate', () => {
        const round = { ...revealedRound, finalEstimate: 'M' };
        const state = roomStateSchema.parse({ ...baseState, round });

        expect(state.round).toEqual(round);
    });
});

describe('room:state tokens', () => {
    it('never carries a session token', () => {
        const state = roomStateSchema.parse({
            ...baseState,
            sessionToken: TOKEN,
            participants: leakyParticipants,
            self: { ...baseState.self, sessionToken: TOKEN },
            round: revealedRound,
        });

        expect(JSON.stringify(state)).not.toContain(TOKEN);
    });
});

describe('room:state history', () => {
    it('keeps one entry per finished round with what "YAK-1231 · G · 71%" needs', () => {
        const entry = {
            roundId: 2,
            issue: { key: 'YAK-1231', summary: 'Métricas bc-mobile' },
            finalEstimate: { value: 'G', meaning: '10+ dias' },
            votes: [
                { name: 'Igor', value: 'G' },
                { name: 'Bruno', value: 'G' },
                { name: 'Ana', value: 'M' },
            ],
            kiroGuesses: [{ name: 'Kiro do Igor', value: 'G' }],
            kiroCountedAsPlayer: false,
            revealedAt: 1_700_000_100_000,
        };
        const state: RoomState = roomStateSchema.parse({ ...baseState, round: votingRound, history: [entry] });

        expect(state.history).toEqual([entry]);
    });
});

describe('room:state jira', () => {
    it('carries the connection, the agenda and the current card', () => {
        const summary = {
            key: 'YAK-1234',
            summary: 'Ajustar cache de opções de parcelas',
            issueType: 'História',
            status: 'Refinamento',
            size: null,
            url: 'https://jiraps.atlassian.net/browse/YAK-1234',
        };
        const jira = {
            connected: true,
            agenda: [summary],
            currentIssue: { ...summary, assignee: null, descriptionHtml: '<p>x</p>', sizeField: null },
        };

        expect(roomStateSchema.parse({ ...baseState, round: votingRound, jira }).jira).toEqual(jira);
    });
});

describe('server restart', () => {
    it('lets the client compare the server instance of the state with the one of room_not_found', () => {
        const state = roomStateSchema.parse({ ...baseState, round: votingRound });
        const error = appErrorSchema.parse({ code: 'room_not_found', serverInstanceId: 'srv-boot-2' });

        expect(state.serverInstanceId).toBe('srv-boot-1');
        expect(error.code === 'room_not_found' && error.serverInstanceId).toBe('srv-boot-2');
    });
});
