import type { z } from 'zod';
import {
    CLIENT_EVENTS,
    type ClientEventName,
    type ClientEventPayload,
    handshakeAuthSchema,
    jiraAgendaRequestSchema,
    jiraCurrentIssueRequestSchema,
    jiraLoginQuerySchema,
    jiraRoomIssuePathParamsSchema,
    jiraRoomPathParamsSchema,
    jiraSaveSizeRequestSchema,
    jiraSessionRequestSchema,
} from '../contracts';

const TOKEN = 'K'.repeat(43);
const CUSTOM_CARDS = [{ value: 'A' }, { value: 'B' }];

const CLIENT_EVENT_SAMPLES: { [E in ClientEventName]: ClientEventPayload<E> } = {
    'room:create': { roomName: 'Refinamento Yak', participantName: 'Igor', settings: { autoReveal: true } },
    'room:join': { roomCode: 'yak-7f3k', name: 'Júlia', role: 'player', sessionToken: TOKEN },
    'room:leave': {},
    'room:updateSettings': { countdownSeconds: 5 },
    'room:transferFacilitator': { participantId: 'p-julia' },
    'room:setRole': { role: 'spectator' },
    'round:vote': { roundId: 1, value: 'M' },
    'round:reveal': { roundId: 1, confirmMissingVotes: true },
    'round:reset': { roundId: 1 },
    'round:finalize': { roundId: 1, value: 'M' },
};

const OTHER_RECEIVED_PAYLOADS: [string, z.ZodType, Record<string, unknown>][] = [
    ['handshake auth', handshakeAuthSchema, { protocolVersion: '1.0' }],
    ['GET /api/auth/jira/login query', jiraLoginQuerySchema, { mesa: 'yak-7f3k' }],
    ['POST /api/auth/jira/session body', jiraSessionRequestSchema, { code: TOKEN }],
    ['POST agenda body by keys', jiraAgendaRequestSchema, { type: 'keys', keys: ['YAK-1'] }],
    ['POST agenda body by JQL', jiraAgendaRequestSchema, { type: 'jql', jql: 'project = YAK' }],
    ['PUT current-issue body', jiraCurrentIssueRequestSchema, { issueKey: 'YAK-1' }],
    ['PUT size body', jiraSaveSizeRequestSchema, { value: 'M' }],
    ['room path params', jiraRoomPathParamsSchema, { roomCode: 'yak-7f3k' }],
    ['room issue path params', jiraRoomIssuePathParamsSchema, { roomCode: 'yak-7f3k', issueKey: 'YAK-1' }],
];

const createWithSettings = (settings: unknown) => ({ roomName: 'Mesa', participantName: 'Igor', settings });

const NESTED_UNKNOWN_FIELDS: [string, z.ZodType, unknown, unknown][] = [
    [
        'room:create settings',
        CLIENT_EVENTS['room:create'].payload,
        createWithSettings({ autoReveal: true }),
        createWithSettings({ autoReveal: true, unknownField: true }),
    ],
    [
        'room:create deck',
        CLIENT_EVENTS['room:create'].payload,
        createWithSettings({ deck: { presetId: 'custom', cards: CUSTOM_CARDS } }),
        createWithSettings({ deck: { presetId: 'custom', cards: CUSTOM_CARDS, unknownField: true } }),
    ],
    [
        'room:create card',
        CLIENT_EVENTS['room:create'].payload,
        createWithSettings({ deck: { presetId: 'custom', cards: CUSTOM_CARDS } }),
        createWithSettings({ deck: { presetId: 'custom', cards: [{ value: 'A', unknownField: true }, { value: 'B' }] } }),
    ],
    [
        'room:updateSettings card',
        CLIENT_EVENTS['room:updateSettings'].payload,
        { deck: { presetId: 'custom', cards: CUSTOM_CARDS } },
        { deck: { presetId: 'custom', cards: [{ value: 'A' }, { value: 'B', unknownField: true }] } },
    ],
];

describe('strict client to server payloads', () => {
    it('has a sample for every client event', () => {
        expect(Object.keys(CLIENT_EVENT_SAMPLES).sort()).toEqual(Object.keys(CLIENT_EVENTS).sort());
    });

    it.each(Object.entries(CLIENT_EVENT_SAMPLES))(
        '%s accepts the sample and rejects it with an unknown field',
        (event, sample) => {
            const { payload } = CLIENT_EVENTS[event as ClientEventName];

            expect(payload.safeParse(sample).success).toBe(true);
            expect(payload.safeParse({ ...sample, unknownField: true }).success).toBe(false);
        },
    );

    it.each(OTHER_RECEIVED_PAYLOADS)('%s accepts the sample and rejects it with an unknown field', (_name, schema, sample) => {
        expect(schema.safeParse(sample).success).toBe(true);
        expect(schema.safeParse({ ...sample, unknownField: true }).success).toBe(false);
    });

    it.each(NESTED_UNKNOWN_FIELDS)('%s rejects an unknown nested field', (_name, schema, valid, invalid) => {
        expect(schema.safeParse(valid).success).toBe(true);
        expect(schema.safeParse(invalid).success).toBe(false);
    });
});
