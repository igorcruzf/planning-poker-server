import { z } from 'zod';
import {
    ackSchema,
    type AppError,
    type AppErrorOf,
    appErrorSchema,
    ERROR_CODES,
    ERROR_HTTP_STATUS,
    type ErrorCode,
    httpErrorBodySchema,
} from '../contracts';

const ERROR_SAMPLES: { [C in ErrorCode]: AppErrorOf<C> } = {
    invalid_payload: { code: 'invalid_payload', issues: [{ path: 'name', message: 'Too big' }] },
    internal_error: { code: 'internal_error' },
    protocol_version_unsupported: { code: 'protocol_version_unsupported', serverProtocolVersion: '1.0' },
    room_not_found: { code: 'room_not_found', serverInstanceId: 'srv-boot-1' },
    session_token_invalid: { code: 'session_token_invalid' },
    forbidden: { code: 'forbidden', reason: 'facilitator_only' },
    votes_pending: {
        code: 'votes_pending',
        missing: [
            { participantId: 'p-julia', name: 'Júlia' },
            { participantId: 'p-leo', name: 'Leo' },
        ],
    },
    round_stale: { code: 'round_stale' },
    wrong_phase: { code: 'wrong_phase', phase: 'voting' },
    invalid_vote: { code: 'invalid_vote' },
    invalid_target: { code: 'invalid_target' },
    rate_limited: { code: 'rate_limited', retryAfterMs: 1200 },
    spectators_disabled: { code: 'spectators_disabled' },
    kiro_disabled: { code: 'kiro_disabled' },
    kiro_limit_per_owner: { code: 'kiro_limit_per_owner', limit: 1 },
    kiro_limit_per_room: { code: 'kiro_limit_per_room', limit: 3 },
    invite_invalid: { code: 'invite_invalid' },
    jira_disabled: { code: 'jira_disabled' },
    jira_room_not_linked: { code: 'jira_room_not_linked' },
    jira_login_failed: { code: 'jira_login_failed' },
    jira_login_code_invalid: { code: 'jira_login_code_invalid' },
    jira_reconnect_required: { code: 'jira_reconnect_required' },
    jira_forbidden: { code: 'jira_forbidden' },
    jira_size_unavailable: { code: 'jira_size_unavailable' },
    jira_size_option_missing: { code: 'jira_size_option_missing' },
    jira_issue_not_found: { code: 'jira_issue_not_found' },
    jira_rate_limited: { code: 'jira_rate_limited', retryAfterMs: 5000 },
    jira_unavailable: { code: 'jira_unavailable' },
};

const SITUATIONS: [string, AppError][] = [
    ['invalid payload', ERROR_SAMPLES.invalid_payload],
    ['room not found or already closed', ERROR_SAMPLES.room_not_found],
    ['unsupported protocol version', ERROR_SAMPLES.protocol_version_unsupported],
    ['invalid session token', ERROR_SAMPLES.session_token_invalid],
    ['D8: a non-player tries to reveal or reset', { code: 'forbidden', reason: 'players_only' }],
    ['role: an action that needs a player', { code: 'forbidden', reason: 'players_only' }],
    ['facilitator only action', { code: 'forbidden', reason: 'facilitator_only' }],
    ['action before joining a room', { code: 'forbidden', reason: 'not_in_room' }],
    ['pending votes with the names of who is missing', ERROR_SAMPLES.votes_pending],
    ['rate limit with the waiting time', ERROR_SAMPLES.rate_limited],
    ['spectators disabled in the room', ERROR_SAMPLES.spectators_disabled],
    ['Kiro disabled in the room', ERROR_SAMPLES.kiro_disabled],
    ['Kiro limit per person', ERROR_SAMPLES.kiro_limit_per_owner],
    ['Kiro limit per room', ERROR_SAMPLES.kiro_limit_per_room],
    ['invalid or expired invite', ERROR_SAMPLES.invite_invalid],
    ['Jira disabled on the server', ERROR_SAMPLES.jira_disabled],
    ['Jira 401: reconnect', ERROR_SAMPLES.jira_reconnect_required],
    ['Jira 403: no permission on the card', ERROR_SAMPLES.jira_forbidden],
    ['Jira 400: card without Size', ERROR_SAMPLES.jira_size_unavailable],
    ['Jira 429: rate limit', ERROR_SAMPLES.jira_rate_limited],
];

describe('error catalog', () => {
    it.each(SITUATIONS)('has a catalog code for %s', (_situation, error) => {
        expect(ERROR_CODES).toContain(error.code);
        expect(appErrorSchema.parse(error)).toEqual(error);
    });

    it.each(Object.values(ERROR_SAMPLES))('accepts the catalog entry %o', (error) => {
        expect(appErrorSchema.parse(error)).toEqual(error);
    });

    it('lists exactly the sampled codes', () => {
        expect([...ERROR_CODES].sort()).toEqual(Object.keys(ERROR_SAMPLES).sort());
    });

    it('rejects an unknown code', () => {
        expect(appErrorSchema.safeParse({ code: 'not_a_code' }).success).toBe(false);
    });

    it.each([
        { code: 'votes_pending' },
        { code: 'rate_limited' },
        { code: 'rate_limited', retryAfterMs: -1 },
        { code: 'forbidden', reason: 'nope' },
        { code: 'room_not_found' },
    ])('rejects %o without its required details', (error) => {
        expect(appErrorSchema.safeParse(error).success).toBe(false);
    });

    it.each([
        ['jira_reconnect_required', 401],
        ['jira_forbidden', 403],
        ['jira_size_unavailable', 400],
        ['jira_rate_limited', 429],
    ] as const)('maps %s to HTTP %i like the Jira error table', (code, status) => {
        expect(ERROR_HTTP_STATUS[code]).toBe(status);
    });

    it('maps every code to an HTTP error status', () => {
        for (const code of ERROR_CODES) {
            expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
            expect(ERROR_HTTP_STATUS[code]).toBeLessThan(600);
        }
    });

    it('wraps HTTP errors in an error body', () => {
        const body = { error: ERROR_SAMPLES.jira_forbidden };

        expect(httpErrorBodySchema.parse(body)).toEqual(body);
    });
});

describe('ack', () => {
    const roomCodeAck = ackSchema(z.object({ roomCode: z.string() }));

    it('accepts a success with typed data', () => {
        expect(roomCodeAck.parse({ ok: true, data: { roomCode: 'yak-7f3k' } })).toEqual({
            ok: true,
            data: { roomCode: 'yak-7f3k' },
        });
    });

    it('accepts a failure with a catalog error', () => {
        const failure = { ok: false, error: ERROR_SAMPLES.votes_pending };

        expect(roomCodeAck.parse(failure)).toEqual(failure);
    });

    it.each([
        { ok: true, data: { roomCode: 1 } },
        { ok: false, error: { code: 'not_a_code' } },
        { ok: false },
        { data: { roomCode: 'yak-7f3k' } },
    ])('rejects %o', (ack) => {
        expect(roomCodeAck.safeParse(ack).success).toBe(false);
    });
});
