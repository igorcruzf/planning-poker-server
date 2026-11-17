import {
    JIRA_AGENDA_MAX_ISSUES,
    JIRA_DESCRIPTION_HTML_MAX_LENGTH,
    jiraIssueSchema,
    jiraIssueSummarySchema,
} from '../../contracts';
import { JiraAppException } from '../auth/jira-app.exception';
import { JiraSessionService } from '../auth/jira-session.service';
import { JiraApiClient } from './jira-api.client';
import { createJiraCall } from './jira-call';
import { JiraTransport } from './jira-transport';
import {
    API_BASE,
    CLOUD_ID,
    FakeReply,
    SIZE_FIELD_ID,
    SITE_URL,
    createFakeAtlassian,
    createFakeSessions,
    issueJson,
    reply,
    sizeEditmeta,
} from './jira-api.fakes';

const fieldsReply = reply(200, [
    { id: 'summary', name: 'Summary' },
    { id: SIZE_FIELD_ID, name: 'Size' },
]);

const errorOf = async (promise: Promise<unknown>) => {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(JiraAppException);
        return (error as JiraAppException).error;
    }
    throw new Error('expected rejection');
};

describe('JiraApiClient', () => {
    const setup = (replies: FakeReply[], forcedGrant = {}) => {
        const atlassian = createFakeAtlassian(replies);
        const { sessions, calls } = createFakeSessions(forcedGrant);
        const sleeps: number[] = [];
        const client = new JiraApiClient(
            new JiraTransport(sessions, atlassian.fetchFunction, async (ms) => {
                sleeps.push(ms);
            }),
        );
        return { client, atlassian, calls, sleeps, call: createJiraCall('blob-1') };
    };

    describe('searchByKeys', () => {
        it('resolves the keys in the requested order with size and browse url', async () => {
            const { client, atlassian, call } = setup([
                fieldsReply,
                reply(200, {
                    issues: [
                        issueJson('YAK-2', { [SIZE_FIELD_ID]: { id: '2', value: 'M' } }),
                        issueJson('YAK-1', { [SIZE_FIELD_ID]: null }),
                    ],
                }),
            ]);

            const agenda = await client.searchByKeys(call, ['YAK-1', 'YAK-2']);

            expect(agenda).toEqual([
                {
                    key: 'YAK-1',
                    summary: 'Resumo YAK-1',
                    issueType: 'Story',
                    status: 'To Do',
                    size: null,
                    url: `${SITE_URL}/browse/YAK-1`,
                },
                {
                    key: 'YAK-2',
                    summary: 'Resumo YAK-2',
                    issueType: 'Story',
                    status: 'To Do',
                    size: 'M',
                    url: `${SITE_URL}/browse/YAK-2`,
                },
            ]);
            agenda.forEach((summary) => expect(jiraIssueSummarySchema.safeParse(summary).success).toBe(true));
            const search = new URL(atlassian.requests[1].url);
            expect(search.origin + search.pathname).toBe(`${API_BASE}/rest/api/3/search/jql`);
            expect(search.searchParams.get('jql')).toBe('key in (YAK-1,YAK-2)');
            expect(search.searchParams.get('maxResults')).toBe(String(JIRA_AGENDA_MAX_ISSUES));
            expect(search.searchParams.get('fields')).toBe(`summary,issuetype,status,${SIZE_FIELD_ID}`);
        });

        it('sends the access token, refuses redirects and sets a timeout', async () => {
            const { client, atlassian, call } = setup([fieldsReply, reply(200, { issues: [] })]);

            await client.searchByKeys(call, ['YAK-1']);

            const [request] = atlassian.requests;
            expect(request.headers.Authorization).toBe('Bearer access-1');
            expect(request.headers.Accept).toBe('application/json');
            expect(request.init.redirect).toBe('error');
            expect(request.init.signal).toBeInstanceOf(AbortSignal);
        });

        it('omits keys Jira did not return', async () => {
            const { client, call } = setup([fieldsReply, reply(200, { issues: [issueJson('YAK-1')] })]);

            const agenda = await client.searchByKeys(call, ['YAK-1', 'YAK-9']);

            expect(agenda.map((issue) => issue.key)).toEqual(['YAK-1']);
        });

        it('reads the size field id only once per site', async () => {
            const { client, atlassian, call } = setup([
                fieldsReply,
                reply(200, { issues: [] }),
                reply(200, { issues: [] }),
            ]);

            await client.searchByKeys(call, ['YAK-1']);
            await client.searchByKeys(call, ['YAK-2']);

            expect(atlassian.requests.map((request) => new URL(request.url).pathname)).toEqual([
                `/ex/jira/${CLOUD_ID}/rest/api/3/field`,
                `/ex/jira/${CLOUD_ID}/rest/api/3/search/jql`,
                `/ex/jira/${CLOUD_ID}/rest/api/3/search/jql`,
            ]);
        });

        it('skips the size column when the site has no Size field', async () => {
            const { client, atlassian, call } = setup([
                reply(200, [{ id: 'summary', name: 'Summary' }]),
                reply(200, { issues: [issueJson('YAK-1')] }),
            ]);

            const [summary] = await client.searchByKeys(call, ['YAK-1']);

            expect(summary.size).toBeNull();
            expect(new URL(atlassian.requests[1].url).searchParams.get('fields')).toBe('summary,issuetype,status');
        });

        it('maps a 400 (unknown project or key) to jira_issue_not_found', async () => {
            const { client, call } = setup([fieldsReply, reply(400, { errorMessages: ['segredo'] })]);

            expect(await errorOf(client.searchByKeys(call, ['ZZZ-1']))).toEqual({ code: 'jira_issue_not_found' });
        });
    });

    describe('searchByJql', () => {
        it('searches with the JQL and the agenda limit', async () => {
            const { client, atlassian, call } = setup([fieldsReply, reply(200, { issues: [issueJson('YAK-5')] })]);

            const agenda = await client.searchByJql(call, 'project = YAK ORDER BY rank');

            expect(agenda.map((issue) => issue.key)).toEqual(['YAK-5']);
            const search = new URL(atlassian.requests[1].url);
            expect(search.searchParams.get('jql')).toBe('project = YAK ORDER BY rank');
            expect(search.searchParams.get('maxResults')).toBe(String(JIRA_AGENDA_MAX_ISSUES));
        });

        it('truncates a result larger than the agenda limit', async () => {
            const issues = Array.from({ length: JIRA_AGENDA_MAX_ISSUES + 5 }, (_, index) =>
                issueJson(`YAK-${index + 1}`),
            );
            const { client, call } = setup([fieldsReply, reply(200, { issues })]);

            expect(await client.searchByJql(call, 'project = YAK')).toHaveLength(JIRA_AGENDA_MAX_ISSUES);
        });

        it('maps an invalid JQL (400) to invalid_payload without the Atlassian message', async () => {
            const { client, call } = setup([fieldsReply, reply(400, { errorMessages: ['Error in the JQL Query'] })]);

            const error = await errorOf(client.searchByJql(call, 'project ='));

            expect(error).toEqual({ code: 'invalid_payload', issues: [{ path: 'jql', message: 'JQL inválida' }] });
        });
    });

    describe('getIssue', () => {
        const issueReply = (fields: Record<string, unknown> = {}, editmeta: unknown = sizeEditmeta()) =>
            reply(200, {
                ...issueJson('YAK-7', { [SIZE_FIELD_ID]: { id: '2', value: 'M' }, ...fields }),
                renderedFields: { description: '<p>Olá <b>mundo</b></p>' },
                editmeta,
            });

        it('maps the card with renderedFields, assignee and the size field options', async () => {
            const { client, atlassian, call } = setup([issueReply()]);

            const issue = await client.getIssue(call, 'YAK-7');

            expect(issue).toEqual({
                key: 'YAK-7',
                summary: 'Resumo YAK-7',
                issueType: 'Story',
                status: 'To Do',
                size: 'M',
                url: `${SITE_URL}/browse/YAK-7`,
                assignee: 'Ana',
                descriptionHtml: '<p>Olá <b>mundo</b></p>',
                sizeField: {
                    fieldId: SIZE_FIELD_ID,
                    options: [
                        { id: '1', value: 'P' },
                        { id: '2', value: 'M' },
                    ],
                },
            });
            expect(jiraIssueSchema.safeParse(issue).success).toBe(true);
            const url = new URL(atlassian.requests[0].url);
            expect(url.pathname).toBe(`/ex/jira/${CLOUD_ID}/rest/api/3/issue/YAK-7`);
            expect(url.searchParams.get('expand')).toBe('renderedFields,editmeta');
        });

        it('returns a card without Size: no sizeField, null size, null assignee and description', async () => {
            const { client, call } = setup([
                reply(200, {
                    ...issueJson('YAK-8', { assignee: null }),
                    renderedFields: { description: null },
                    editmeta: { fields: {} },
                }),
            ]);

            const issue = await client.getIssue(call, 'YAK-8');

            expect(issue.sizeField).toBeNull();
            expect(issue.size).toBeNull();
            expect(issue.assignee).toBeNull();
            expect(issue.descriptionHtml).toBeNull();
        });

        it('keeps the HTML unsanitized and truncates it to the contract limit', async () => {
            const html = `<script>x</script>${'a'.repeat(JIRA_DESCRIPTION_HTML_MAX_LENGTH)}`;
            const { client, call } = setup([
                reply(200, { ...issueJson('YAK-9'), renderedFields: { description: html }, editmeta: { fields: {} } }),
            ]);

            const issue = await client.getIssue(call, 'YAK-9');

            expect(issue.descriptionHtml?.startsWith('<script>x</script>')).toBe(true);
            expect(issue.descriptionHtml).toHaveLength(JIRA_DESCRIPTION_HTML_MAX_LENGTH);
            expect(jiraIssueSchema.safeParse(issue).success).toBe(true);
        });

        it('drops a tag cut in half by the truncation', async () => {
            const html = `${'a'.repeat(JIRA_DESCRIPTION_HTML_MAX_LENGTH - 3)}<img src="x">`;
            const { client, call } = setup([
                reply(200, { ...issueJson('YAK-9'), renderedFields: { description: html }, editmeta: { fields: {} } }),
            ]);

            const issue = await client.getIssue(call, 'YAK-9');

            expect(issue.descriptionHtml).toBe('a'.repeat(JIRA_DESCRIPTION_HTML_MAX_LENGTH - 3));
        });

        it('clips long texts to the contract limits', async () => {
            const { client, call } = setup([
                reply(200, {
                    ...issueJson('YAK-9', { summary: 'x'.repeat(900), assignee: { displayName: 'y'.repeat(900) } }),
                    renderedFields: {},
                    editmeta: { fields: {} },
                }),
            ]);

            const issue = await client.getIssue(call, 'YAK-9');

            expect(jiraIssueSchema.safeParse(issue).success).toBe(true);
        });

        it('refuses a key that is not a Jira key before any request', async () => {
            const { client, atlassian, call } = setup([]);

            const error = await errorOf(client.getIssue(call, '../admin'));

            expect(error.code).toBe('invalid_payload');
            expect(atlassian.requests).toHaveLength(0);
        });

        it('treats an unexpected response shape as jira_unavailable', async () => {
            const { client, call } = setup([reply(200, { nada: true })]);

            expect(await errorOf(client.getIssue(call, 'YAK-7'))).toEqual({ code: 'jira_unavailable' });
        });
    });

    describe('discoverSizeField', () => {
        it('reads the field named Size and its options from the editmeta', async () => {
            const { client, atlassian, call } = setup([reply(200, sizeEditmeta())]);

            const field = await client.discoverSizeField(call, 'YAK-7');

            expect(field).toEqual({
                fieldId: SIZE_FIELD_ID,
                options: [
                    { id: '1', value: 'P' },
                    { id: '2', value: 'M' },
                ],
            });
            expect(new URL(atlassian.requests[0].url).pathname).toBe(
                `/ex/jira/${CLOUD_ID}/rest/api/3/issue/YAK-7/editmeta`,
            );
        });

        it('returns null when the card has no Size (for example a Spike)', async () => {
            const { client, call } = setup([reply(200, { fields: { other: { name: 'Other' } } })]);

            expect(await client.discoverSizeField(call, 'YAK-7')).toBeNull();
        });

        it('returns an empty option list when the field has no allowed values', async () => {
            const { client, call } = setup([reply(200, { fields: { f1: { name: 'Size' } } })]);

            expect(await client.discoverSizeField(call, 'YAK-7')).toEqual({ fieldId: 'f1', options: [] });
        });
    });

    describe('saveSize', () => {
        it('writes the option id of the card value with PUT', async () => {
            const { client, atlassian, call } = setup([reply(200, sizeEditmeta()), reply(204)]);

            await client.saveSize(call, 'YAK-7', 'M');

            const put = atlassian.requests[1];
            expect(put.method).toBe('PUT');
            expect(new URL(put.url).pathname).toBe(`/ex/jira/${CLOUD_ID}/rest/api/3/issue/YAK-7`);
            expect(put.body).toEqual({ fields: { [SIZE_FIELD_ID]: { id: '2' } } });
            expect(put.headers['Content-Type']).toBe('application/json');
        });

        it('fails with jira_size_unavailable when the card has no Size', async () => {
            const { client, atlassian, call } = setup([reply(200, { fields: {} })]);

            expect(await errorOf(client.saveSize(call, 'YAK-7', 'M'))).toEqual({ code: 'jira_size_unavailable' });
            expect(atlassian.requests).toHaveLength(1);
        });

        it('fails with jira_size_option_missing when no option matches and writes nothing', async () => {
            const { client, atlassian, call } = setup([reply(200, sizeEditmeta())]);

            expect(await errorOf(client.saveSize(call, 'YAK-7', 'GG'))).toEqual({ code: 'jira_size_option_missing' });
            expect(atlassian.requests.map((request) => request.method)).toEqual(['GET']);
        });

        it.each(['?', 'yakult'])('never writes the special card %p and does not call Atlassian', async (value) => {
            const { client, atlassian, call } = setup([]);

            expect(await errorOf(client.saveSize(call, 'YAK-7', value))).toEqual({ code: 'jira_size_option_missing' });
            expect(atlassian.requests).toHaveLength(0);
        });

        it('maps a 400 on the write to jira_size_unavailable', async () => {
            const { client, call } = setup([reply(200, sizeEditmeta()), reply(400, { errors: { f: 'segredo' } })]);

            expect(await errorOf(client.saveSize(call, 'YAK-7', 'M'))).toEqual({ code: 'jira_size_unavailable' });
        });
    });

    describe('addComment', () => {
        it('posts a simple ADF document with the text', async () => {
            const { client, atlassian, call } = setup([reply(201, { id: '10' })]);

            await client.addComment(call, 'YAK-7', 'YakPoker · Size definido: M (até 10 dias)');

            const post = atlassian.requests[0];
            expect(post.method).toBe('POST');
            expect(new URL(post.url).pathname).toBe(`/ex/jira/${CLOUD_ID}/rest/api/3/issue/YAK-7/comment`);
            expect(post.body).toEqual({
                body: {
                    type: 'doc',
                    version: 1,
                    content: [
                        { type: 'paragraph', content: [{ type: 'text', text: 'YakPoker · Size definido: M (até 10 dias)' }] },
                    ],
                },
            });
        });
    });

    describe('errors and session handling', () => {
        const search = (replies: FakeReply[], forcedGrant = {}) => {
            const context = setup(replies, forcedGrant);
            return { ...context, run: () => context.client.getIssue(context.call, 'YAK-7') };
        };

        it('refreshes the token once on 401 and repeats the request', async () => {
            const { run, atlassian, calls, call } = search(
                [reply(401), reply(200, { ...issueJson('YAK-7'), renderedFields: {}, editmeta: { fields: {} } })],
                { refreshedBlob: 'blob-2' },
            );

            const issue = await run();

            expect(issue.key).toBe('YAK-7');
            expect(calls.forceRefresh).toBe(1);
            expect(atlassian.requests.map((request) => request.headers.Authorization)).toEqual([
                'Bearer access-1',
                'Bearer access-2',
            ]);
            expect(call.refreshedBlob).toBe('blob-2');
        });

        it('asks to reconnect when the repeated request is 401 again, refreshing only once', async () => {
            const { run, calls } = search([reply(401), reply(401)]);

            expect(await errorOf(run())).toEqual({ code: 'jira_reconnect_required' });
            expect(calls.forceRefresh).toBe(1);
        });

        it('exposes the blob rotated by the session service', async () => {
            const { sessions } = createFakeSessions();
            const rotating = {
                getAccessToken: async () => ({ ...(await sessions.getAccessToken('x')), refreshedBlob: 'blob-9' }),
            } as unknown as JiraSessionService;
            const client = new JiraApiClient(
                new JiraTransport(
                    rotating,
                    createFakeAtlassian([reply(200, sizeEditmeta())]).fetchFunction,
                    async () => undefined,
                ),
            );
            const call = createJiraCall('blob-1');

            await client.discoverSizeField(call, 'YAK-7');

            expect(call.refreshedBlob).toBe('blob-9');
        });

        it('maps 403 to jira_forbidden and 404 to jira_issue_not_found', async () => {
            expect(await errorOf(search([reply(403)]).run())).toEqual({ code: 'jira_forbidden' });
            expect(await errorOf(search([reply(404)]).run())).toEqual({ code: 'jira_issue_not_found' });
        });

        it.each([500, 502, 503])('maps %i to jira_unavailable', async (status) => {
            expect(await errorOf(search([reply(status)]).run())).toEqual({ code: 'jira_unavailable' });
        });

        it('maps a network failure and a timeout to jira_unavailable', async () => {
            expect(await errorOf(search([new Error('ECONNRESET token=segredo')]).run())).toEqual({
                code: 'jira_unavailable',
            });
            const timeout = new DOMException('timeout', 'TimeoutError');
            expect(await errorOf(search([timeout]).run())).toEqual({ code: 'jira_unavailable' });
        });

        it('maps a non-JSON body to jira_unavailable', async () => {
            const { run } = search([{ status: 200, body: undefined }]);

            expect(await errorOf(run())).toEqual({ code: 'jira_unavailable' });
        });

        it('retries a 429 with exponential backoff and then succeeds', async () => {
            const ok = reply(200, { ...issueJson('YAK-7'), renderedFields: {}, editmeta: { fields: {} } });
            const { run, sleeps, atlassian } = search([reply(429), reply(429), ok]);

            await run();

            expect(sleeps).toEqual([500, 1000]);
            expect(atlassian.requests).toHaveLength(3);
        });

        it('honors Retry-After when the Atlassian sends it', async () => {
            const ok = reply(200, { ...issueJson('YAK-7'), renderedFields: {}, editmeta: { fields: {} } });
            const { run, sleeps } = search([reply(429, undefined, { 'Retry-After': '2' }), ok]);

            await run();

            expect(sleeps).toEqual([2000]);
        });

        it('gives up after three 429s with jira_rate_limited and the wait time', async () => {
            const { run, sleeps, atlassian } = search([reply(429), reply(429), reply(429)]);

            expect(await errorOf(run())).toEqual({ code: 'jira_rate_limited', retryAfterMs: 2000 });
            expect(sleeps).toEqual([500, 1000]);
            expect(atlassian.requests).toHaveLength(3);
        });

        it('caps a huge Retry-After at the maximum delay, in the wait and in the final error', async () => {
            const huge = reply(429, undefined, { 'Retry-After': '86400' });
            const { run, sleeps } = search([huge, huge, huge]);

            expect(await errorOf(run())).toEqual({ code: 'jira_rate_limited', retryAfterMs: 8000 });
            expect(sleeps).toEqual([8000, 8000]);
        });

        it.each([
            ['negative', '-5'],
            ['textual', 'abc'],
            ['an HTTP date', 'Wed, 21 Oct 2026 07:28:00 GMT'],
            ['zero', '0'],
        ])('falls back to the exponential backoff when Retry-After is %s', async (_label, header) => {
            const bad = reply(429, undefined, { 'Retry-After': header });
            const { run, sleeps } = search([bad, bad, bad]);

            expect(await errorOf(run())).toEqual({ code: 'jira_rate_limited', retryAfterMs: 2000 });
            expect(sleeps).toEqual([500, 1000]);
        });

        it('never puts the Atlassian body or the token in the error', async () => {
            const { run } = search([reply(403, { message: 'segredo-do-card', token: 'access-1' })]);

            const error = await run().catch((caught: JiraAppException) => caught);

            const serialized = JSON.stringify(error) + String((error as Error).message);
            expect(serialized).not.toContain('segredo-do-card');
            expect(serialized).not.toContain('access-1');
        });
    });
});
