import {
    JIRA_API_PATHS,
    JIRA_AUTH_PATHS,
    JIRA_AUTHORIZATION_HEADER,
    JIRA_LOGIN_CODE_QUERY_PARAM,
    JIRA_LOGIN_CODE_TTL_MS,
    JIRA_LOGIN_ERROR_QUERY_PARAM,
    JIRA_OAUTH_SCOPES,
    JIRA_OAUTH_STATE_TTL_MS,
    JIRA_PRODUCTION_CALLBACK_URL,
    JIRA_SESSION_HEADER,
    jiraAgendaRequestSchema,
    jiraAuthorizationHeaderSchema,
    jiraIssueKeySchema,
    jiraIssueSchema,
    jiraLoginErrorSchema,
    jiraLoginQuerySchema,
    jiraSaveSizeRequestSchema,
    jiraSessionRequestSchema,
    jiraSessionResponseSchema,
    jiraStatusResponseSchema,
    ROOM_SESSION_HEADER,
} from '../contracts';

const LOGIN_CODE = 'a'.repeat(43);

const ISSUE = {
    key: 'YAK-1234',
    summary: '[installments-service] Ajustar cache de opções de parcelas',
    issueType: 'História',
    status: 'Refinamento',
    size: null,
    url: 'https://jiraps.atlassian.net/browse/YAK-1234',
    assignee: 'Igor',
    descriptionHtml: '<p>Descrição</p>',
    sizeField: {
        fieldId: 'customfield_10191',
        options: [
            { id: '10001', value: 'PP' },
            { id: '10004', value: 'M' },
        ],
    },
};

describe('jira headers', () => {
    it('sends the session blob in Authorization and receives a rotated one in X-Yak-Jira-Session', () => {
        expect(JIRA_AUTHORIZATION_HEADER).toBe('Authorization');
        expect(JIRA_SESSION_HEADER).toBe('X-Yak-Jira-Session');
    });

    it('proves the room session in X-Yak-Room-Session', () => {
        expect(ROOM_SESSION_HEADER).toBe('X-Yak-Room-Session');
    });

    it.each(['Bearer abc', 'Bearer v1.Zm9v_YmFy-'])('accepts the authorization header %p', (header) => {
        expect(jiraAuthorizationHeaderSchema.safeParse(header).success).toBe(true);
    });

    it.each(['Bearer ', 'Basic abc', 'bearer abc', 'Bearer a b', `Bearer ${'a'.repeat(8193)}`])(
        'rejects the authorization header %p',
        (header) => {
            expect(jiraAuthorizationHeaderSchema.safeParse(header).success).toBe(false);
        },
    );
});

describe('jira auth endpoints', () => {
    it('uses the paths of the plan', () => {
        expect(JIRA_AUTH_PATHS).toEqual({
            login: '/api/auth/jira/login',
            callback: '/api/auth/jira/callback',
            session: '/api/auth/jira/session',
            logout: '/api/auth/jira/logout',
        });
        expect(JIRA_PRODUCTION_CALLBACK_URL).toBe(
            'https://planning-poker-server-slaf.onrender.com/api/auth/jira/callback',
        );
    });

    it('keeps the OAuth state for 10 minutes and the single use code for 60 seconds', () => {
        expect(JIRA_OAUTH_STATE_TTL_MS).toBe(10 * 60 * 1000);
        expect(JIRA_LOGIN_CODE_TTL_MS).toBe(60 * 1000);
    });

    it('asks for the scopes of the plan', () => {
        expect(JIRA_OAUTH_SCOPES).toEqual(['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access']);
    });

    it('redirects to the front with ?jira=<code> or ?jira_error=<code>', () => {
        expect(JIRA_LOGIN_CODE_QUERY_PARAM).toBe('jira');
        expect(JIRA_LOGIN_ERROR_QUERY_PARAM).toBe('jira_error');
        expect(jiraLoginErrorSchema.options).toEqual(['jira_login_failed', 'jira_disabled']);
    });

    it('accepts the room code as an optional login parameter', () => {
        expect(jiraLoginQuerySchema.parse({})).toEqual({});
        expect(jiraLoginQuerySchema.parse({ mesa: 'yak-7f3k' })).toEqual({ mesa: 'yak-7f3k' });
        expect(jiraLoginQuerySchema.safeParse({ mesa: 'https://evil.example' }).success).toBe(false);
    });

    it('exchanges the single use code for the session', () => {
        expect(jiraSessionRequestSchema.parse({ code: LOGIN_CODE })).toEqual({ code: LOGIN_CODE });
        expect(jiraSessionRequestSchema.safeParse({ code: 'short' }).success).toBe(false);
        expect(jiraSessionRequestSchema.safeParse({}).success).toBe(false);
    });

    it('answers the exchange with the site and keeps the blob out of the body', () => {
        const body = { siteUrl: 'https://jiraps.atlassian.net', session: 'blob' };

        expect(jiraSessionResponseSchema.parse(body)).toEqual({ siteUrl: 'https://jiraps.atlassian.net' });
    });
});

describe('jira api', () => {
    it('lives under /api/jira/', () => {
        Object.values(JIRA_API_PATHS).forEach((path) => expect(path.startsWith('/api/jira/')).toBe(true));
    });

    it('tells whether Jira is enabled on the server', () => {
        expect(jiraStatusResponseSchema.parse({ enabled: false })).toEqual({ enabled: false });
    });

    it('builds the agenda from keys, normalizing them', () => {
        expect(jiraAgendaRequestSchema.parse({ type: 'keys', keys: ['yak-1234', ' YAK-1235 '] })).toEqual({
            type: 'keys',
            keys: ['YAK-1234', 'YAK-1235'],
        });
    });

    it('builds the agenda from JQL', () => {
        const request = { type: 'jql', jql: 'project = YAK AND status = Refinamento' };

        expect(jiraAgendaRequestSchema.parse(request)).toEqual(request);
    });

    it.each([
        { type: 'keys', keys: [] },
        { type: 'keys', keys: Array.from({ length: 51 }, (_, index) => `YAK-${index + 1}`) },
        { type: 'keys', keys: ['YAK-0'] },
        { type: 'jql', jql: '   ' },
        { type: 'jql', jql: 'x'.repeat(2001) },
        { type: 'board', id: 1 },
    ])('rejects the agenda request %o', (request) => {
        expect(jiraAgendaRequestSchema.safeParse(request).success).toBe(false);
    });

    it.each(['YAK-1', 'ABC_2-99'])('accepts the issue key %p', (key) => {
        expect(jiraIssueKeySchema.safeParse(key).success).toBe(true);
    });

    it.each(['YAK', '1YAK-1', 'YAK-01', 'YAK 1', '../YAK-1'])('rejects the issue key %p', (key) => {
        expect(jiraIssueKeySchema.safeParse(key).success).toBe(false);
    });

    it('describes the read only card with Size and its editmeta options', () => {
        expect(jiraIssueSchema.parse(ISSUE)).toEqual(ISSUE);
    });

    it('describes a card without the Size field', () => {
        const spike = { ...ISSUE, issueType: 'Spike', sizeField: null };

        expect(jiraIssueSchema.parse(spike)).toEqual(spike);
    });

    it('rejects a card link that is not http(s)', () => {
        expect(jiraIssueSchema.safeParse({ ...ISSUE, url: 'javascript:alert(1)' }).success).toBe(false);
    });

    it('saves Size with a deck card', () => {
        expect(jiraSaveSizeRequestSchema.parse({ value: 'M' })).toEqual({ value: 'M' });
    });

    it.each(['?', 'yakult'])('never saves the special card %p as Size', (value) => {
        expect(jiraSaveSizeRequestSchema.safeParse({ value }).success).toBe(false);
    });
});
