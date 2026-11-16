import { z } from 'zod';
import { durationMsSchema, participantIdSchema, serverInstanceIdSchema } from './primitives';
import { roundPhaseSchema } from './round';

export const errorCodeSchema = z.enum([
    'invalid_payload',
    'internal_error',
    'protocol_version_unsupported',
    'room_not_found',
    'session_token_invalid',
    'forbidden',
    'votes_pending',
    'round_stale',
    'wrong_phase',
    'invalid_vote',
    'invalid_target',
    'rate_limited',
    'spectators_disabled',
    'kiro_disabled',
    'kiro_limit_per_owner',
    'kiro_limit_per_room',
    'invite_invalid',
    'jira_disabled',
    'jira_room_not_linked',
    'jira_login_failed',
    'jira_login_code_invalid',
    'jira_reconnect_required',
    'jira_forbidden',
    'jira_size_unavailable',
    'jira_size_option_missing',
    'jira_issue_not_found',
    'jira_rate_limited',
    'jira_unavailable',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export const ERROR_CODES = errorCodeSchema.options;

export const forbiddenReasonSchema = z.enum(['not_in_room', 'players_only', 'facilitator_only']);
export type ForbiddenReason = z.infer<typeof forbiddenReasonSchema>;

export const INVALID_PAYLOAD_MAX_ISSUES = 20;
export const INVALID_PAYLOAD_TEXT_MAX_LENGTH = 200;
const invalidPayloadTextSchema = z.string().max(INVALID_PAYLOAD_TEXT_MAX_LENGTH);
export const invalidPayloadErrorSchema = z.object({
    code: z.literal('invalid_payload'),
    issues: z
        .array(z.object({ path: invalidPayloadTextSchema, message: invalidPayloadTextSchema }))
        .max(INVALID_PAYLOAD_MAX_ISSUES),
});

export const protocolVersionErrorSchema = z.object({
    code: z.literal('protocol_version_unsupported'),
    serverProtocolVersion: z.string(),
});

export const roomNotFoundErrorSchema = z.object({
    code: z.literal('room_not_found'),
    serverInstanceId: serverInstanceIdSchema,
});

export const forbiddenErrorSchema = z.object({
    code: z.literal('forbidden'),
    reason: forbiddenReasonSchema,
});

export const votesPendingErrorSchema = z.object({
    code: z.literal('votes_pending'),
    missing: z.array(z.object({ participantId: participantIdSchema, name: z.string() })),
});

export const wrongPhaseErrorSchema = z.object({
    code: z.literal('wrong_phase'),
    phase: roundPhaseSchema,
});

export const rateLimitedErrorSchema = z.object({
    code: z.literal('rate_limited'),
    retryAfterMs: durationMsSchema,
});

export const kiroLimitPerOwnerErrorSchema = z.object({
    code: z.literal('kiro_limit_per_owner'),
    limit: z.number().int().positive(),
});

export const kiroLimitPerRoomErrorSchema = z.object({
    code: z.literal('kiro_limit_per_room'),
    limit: z.number().int().positive(),
});

export const jiraRateLimitedErrorSchema = z.object({
    code: z.literal('jira_rate_limited'),
    retryAfterMs: durationMsSchema,
});

const errorWithoutDetailsSchema = z.object({
    code: errorCodeSchema.exclude([
        'invalid_payload',
        'protocol_version_unsupported',
        'room_not_found',
        'forbidden',
        'votes_pending',
        'wrong_phase',
        'rate_limited',
        'kiro_limit_per_owner',
        'kiro_limit_per_room',
        'jira_rate_limited',
    ]),
});

export const appErrorSchema = z.discriminatedUnion('code', [
    errorWithoutDetailsSchema,
    invalidPayloadErrorSchema,
    protocolVersionErrorSchema,
    roomNotFoundErrorSchema,
    forbiddenErrorSchema,
    votesPendingErrorSchema,
    wrongPhaseErrorSchema,
    rateLimitedErrorSchema,
    kiroLimitPerOwnerErrorSchema,
    kiroLimitPerRoomErrorSchema,
    jiraRateLimitedErrorSchema,
]);
export type AppError = z.infer<typeof appErrorSchema>;
export type AppErrorOf<C extends ErrorCode> = AppError & { code: C };

export const ERROR_HTTP_STATUS = {
    invalid_payload: 400,
    internal_error: 500,
    protocol_version_unsupported: 400,
    room_not_found: 404,
    session_token_invalid: 401,
    forbidden: 403,
    votes_pending: 409,
    round_stale: 409,
    wrong_phase: 409,
    invalid_vote: 400,
    invalid_target: 400,
    rate_limited: 429,
    spectators_disabled: 403,
    kiro_disabled: 403,
    kiro_limit_per_owner: 409,
    kiro_limit_per_room: 409,
    invite_invalid: 404,
    jira_disabled: 503,
    jira_room_not_linked: 409,
    jira_login_failed: 400,
    jira_login_code_invalid: 400,
    jira_reconnect_required: 401,
    jira_forbidden: 403,
    jira_size_unavailable: 400,
    jira_size_option_missing: 400,
    jira_issue_not_found: 404,
    jira_rate_limited: 429,
    jira_unavailable: 502,
} as const satisfies Record<ErrorCode, number>;

export const httpErrorBodySchema = z.object({ error: appErrorSchema });
export type HttpErrorBody = z.infer<typeof httpErrorBodySchema>;
