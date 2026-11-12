import { z } from 'zod';
import { cardValueSchema } from './deck';
import { errorCodeSchema } from './errors';
import { httpUrlSchema, roomCodeSchema, secretTokenSchema } from './primitives';

export const JIRA_AUTHORIZATION_HEADER = 'Authorization';
export const JIRA_AUTHORIZATION_SCHEME = 'Bearer';
export const JIRA_SESSION_HEADER = 'X-Yak-Jira-Session';
export const ROOM_SESSION_HEADER = 'X-Yak-Room-Session';

export const JIRA_AUTH_PATHS = {
    login: '/api/auth/jira/login',
    callback: '/api/auth/jira/callback',
    session: '/api/auth/jira/session',
    logout: '/api/auth/jira/logout',
} as const;

export const JIRA_API_PATHS = {
    status: '/api/jira/status',
    agenda: '/api/jira/rooms/:roomCode/agenda',
    agendaIssue: '/api/jira/rooms/:roomCode/agenda/:issueKey',
    currentIssue: '/api/jira/rooms/:roomCode/current-issue',
    issueSize: '/api/jira/rooms/:roomCode/issues/:issueKey/size',
} as const;

export const JIRA_PRODUCTION_CALLBACK_URL = 'https://planning-poker-server-slaf.onrender.com/api/auth/jira/callback';
export const JIRA_OAUTH_SCOPES = ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'] as const;
export const JIRA_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const JIRA_LOGIN_CODE_TTL_MS = 60 * 1000;
export const JIRA_SIZE_FIELD_NAME = 'Size';
export const JIRA_AGENDA_MAX_ISSUES = 50;
export const JIRA_JQL_MAX_LENGTH = 2000;
export const JIRA_ISSUE_KEY_MAX_LENGTH = 32;
export const JIRA_SESSION_BLOB_MAX_LENGTH = 8192;

export const JIRA_LOGIN_CODE_QUERY_PARAM = 'jira';
export const JIRA_LOGIN_ERROR_QUERY_PARAM = 'jira_error';
export const jiraLoginErrorSchema = errorCodeSchema.extract(['jira_login_failed', 'jira_disabled']);
export type JiraLoginError = z.infer<typeof jiraLoginErrorSchema>;

const JIRA_SESSION_BLOB_CHARACTERS = '[A-Za-z0-9_.-]';
export const jiraSessionBlobSchema = z
    .string()
    .regex(new RegExp(`^${JIRA_SESSION_BLOB_CHARACTERS}{1,${JIRA_SESSION_BLOB_MAX_LENGTH}}$`));
export const jiraAuthorizationHeaderSchema = z
    .string()
    .regex(
        new RegExp(
            `^${JIRA_AUTHORIZATION_SCHEME} ${JIRA_SESSION_BLOB_CHARACTERS}{1,${JIRA_SESSION_BLOB_MAX_LENGTH}}$`,
        ),
    );

export const JIRA_ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-[1-9]\d*$/;
export const jiraIssueKeySchema = z
    .string()
    .trim()
    .toUpperCase()
    .max(JIRA_ISSUE_KEY_MAX_LENGTH)
    .regex(JIRA_ISSUE_KEY_PATTERN);
export type JiraIssueKey = z.infer<typeof jiraIssueKeySchema>;

export const jiraLoginQuerySchema = z.strictObject({ mesa: roomCodeSchema.optional() });
export type JiraLoginQuery = z.infer<typeof jiraLoginQuerySchema>;

export const jiraLoginCodeSchema = secretTokenSchema;
export const jiraSessionRequestSchema = z.strictObject({ code: jiraLoginCodeSchema });
export type JiraSessionRequest = z.infer<typeof jiraSessionRequestSchema>;

export const jiraSessionResponseSchema = z.object({ siteUrl: httpUrlSchema });
export type JiraSessionResponse = z.infer<typeof jiraSessionResponseSchema>;

export const jiraStatusResponseSchema = z.object({ enabled: z.boolean() });
export type JiraStatusResponse = z.infer<typeof jiraStatusResponseSchema>;

export const jiraRoomPathParamsSchema = z.strictObject({ roomCode: roomCodeSchema });
export const jiraRoomIssuePathParamsSchema = z.strictObject({ roomCode: roomCodeSchema, issueKey: jiraIssueKeySchema });

export const jiraAgendaRequestSchema = z.discriminatedUnion('type', [
    z.strictObject({
        type: z.literal('keys'),
        keys: z.array(jiraIssueKeySchema).min(1).max(JIRA_AGENDA_MAX_ISSUES),
    }),
    z.strictObject({
        type: z.literal('jql'),
        jql: z.string().trim().min(1).max(JIRA_JQL_MAX_LENGTH),
    }),
]);
export type JiraAgendaRequest = z.infer<typeof jiraAgendaRequestSchema>;

export const jiraCurrentIssueRequestSchema = z.strictObject({ issueKey: jiraIssueKeySchema });
export type JiraCurrentIssueRequest = z.infer<typeof jiraCurrentIssueRequestSchema>;

export const jiraSaveSizeRequestSchema = z.strictObject({ value: cardValueSchema });
export type JiraSaveSizeRequest = z.infer<typeof jiraSaveSizeRequestSchema>;

export const jiraIssueSummarySchema = z.object({
    key: z.string(),
    summary: z.string(),
    issueType: z.string(),
    status: z.string(),
    size: z.string().nullable(),
    url: httpUrlSchema,
});
export type JiraIssueSummary = z.infer<typeof jiraIssueSummarySchema>;

export const jiraSizeOptionSchema = z.object({ id: z.string(), value: z.string() });
export type JiraSizeOption = z.infer<typeof jiraSizeOptionSchema>;

export const jiraSizeFieldSchema = z.object({ fieldId: z.string(), options: z.array(jiraSizeOptionSchema) });
export type JiraSizeField = z.infer<typeof jiraSizeFieldSchema>;

export const jiraIssueSchema = jiraIssueSummarySchema.extend({
    assignee: z.string().nullable(),
    descriptionHtml: z.string().nullable(),
    sizeField: jiraSizeFieldSchema.nullable(),
});
export type JiraIssue = z.infer<typeof jiraIssueSchema>;

export const jiraAgendaResponseSchema = z.object({ agenda: z.array(jiraIssueSummarySchema) });
export type JiraAgendaResponse = z.infer<typeof jiraAgendaResponseSchema>;

export const jiraIssueResponseSchema = z.object({ issue: jiraIssueSchema });
export type JiraIssueResponse = z.infer<typeof jiraIssueResponseSchema>;

export const jiraSaveSizeResponseSchema = z.object({ issue: jiraIssueSchema, commentPosted: z.boolean() });
export type JiraSaveSizeResponse = z.infer<typeof jiraSaveSizeResponseSchema>;

export const jiraRoomStateSchema = z.object({
    connected: z.boolean(),
    agenda: z.array(jiraIssueSummarySchema),
    currentIssue: jiraIssueSchema.nullable(),
});
export type JiraRoomState = z.infer<typeof jiraRoomStateSchema>;
