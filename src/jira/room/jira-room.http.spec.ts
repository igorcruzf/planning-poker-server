import { INestApplication, LoggerService, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AddressInfo } from 'node:net';
import {
    JIRA_AGENDA_MAX_ISSUES,
    JIRA_SESSION_HEADER,
    RoomSession,
    RoomState,
    ROOM_SESSION_HEADER,
    jiraAgendaResponseSchema,
    jiraIssueResponseSchema,
    jiraSaveSizeResponseSchema,
    roomStateSchema,
} from '../../contracts';
import { DomainModule } from '../../domain/domain.module';
import { RoomService } from '../../domain/room.service';
import { roomPayload } from '../../domain/testing/room-fixtures';
import { JiraApiClient } from '../api/jira-api.client';
import { SIZE_FIELD_ID, SITE_URL, issueJson, sizeEditmeta } from '../api/jira-api.fakes';
import { JiraTransport } from '../api/jira-transport';
import { JIRA_FETCH, JIRA_SLEEP } from '../auth/jira-auth.tokens';
import { JiraAccessGrant, JiraSessionService } from '../auth/jira-session.service';
import { JiraIssuesService } from '../http/jira-issues.service';
import { JiraRoomController } from './jira-room.controller';
import { JiraRoomService } from './jira-room.service';

const BLOB = 'blob-secret-1';
const ROOM_TOKEN_HEADER = ROOM_SESSION_HEADER;

class LogCollector implements LoggerService {
    readonly lines: string[] = [];
    log = (...args: unknown[]) => this.record(args);
    error = (...args: unknown[]) => this.record(args);
    warn = (...args: unknown[]) => this.record(args);
    debug = (...args: unknown[]) => this.record(args);
    verbose = (...args: unknown[]) => this.record(args);
    private record(args: unknown[]) {
        this.lines.push(args.map(String).join(' '));
    }
}

type Atlassian = (url: URL, init: RequestInit) => Response;

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Jira room endpoints', () => {
    let app: INestApplication;
    let base: string;
    let rooms: RoomService;
    let logs: LogCollector;
    let atlassianRequests: { method: string; path: string; body?: unknown }[];
    let atlassian: Atlassian;
    let grant: Partial<JiraAccessGrant>;
    let changes: string[];
    let owner: RoomSession;
    let guest: RoomSession;
    const unsubscribers: (() => void)[] = [];

    const issues: Record<string, ReturnType<typeof issueJson>> = {};
    const defaultAtlassian: Atlassian = (url, init) => {
        const path = url.pathname.replace(/^\/ex\/jira\/[^/]+/, '');
        if (path === '/rest/api/3/field') return json([{ id: SIZE_FIELD_ID, name: 'Size' }]);
        if (path === '/rest/api/3/search/jql') {
            const keys = (url.searchParams.get('jql') ?? '').match(/[A-Z]+-\d+/g) ?? [];
            return json({ issues: keys.filter((key) => issues[key]).map((key) => issues[key]) });
        }
        const comment = path.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment$/);
        if (comment) return json({ id: '1' }, 201);
        const editmeta = path.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/editmeta$/);
        if (editmeta) return json(sizeEditmeta());
        const issue = path.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/);
        if (issue && init.method === 'PUT') return new Response(null, { status: 204 });
        if (issue) {
            const found = issues[issue[1]];
            return found
                ? json({ ...found, renderedFields: { description: '<p>Descrição</p>' }, editmeta: sizeEditmeta() })
                : json({}, 404);
        }
        return json({}, 404);
    };

    const start = async () => {
        const sessions = {
            getAccessToken: async () => ({
                accessToken: 'access-1',
                cloudId: 'cloud-1',
                accountId: 'account-1',
                siteUrl: SITE_URL,
                ...grant,
            }),
            forceRefresh: async () => ({
                accessToken: 'access-2',
                cloudId: 'cloud-1',
                accountId: 'account-1',
                siteUrl: SITE_URL,
                ...grant,
            }),
        } as unknown as JiraSessionService;
        const fetchFunction = async (url: string, init: RequestInit) => {
            const parsed = new URL(url);
            atlassianRequests.push({
                method: init.method ?? 'GET',
                path: parsed.pathname.replace(/^\/ex\/jira\/[^/]+/, ''),
                body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
            });
            return atlassian(parsed, init);
        };

        @Module({
            imports: [DomainModule],
            controllers: [JiraRoomController],
            providers: [
                JiraRoomService,
                JiraIssuesService,
                JiraApiClient,
                JiraTransport,
                { provide: JiraSessionService, useValue: sessions },
                { provide: JIRA_FETCH, useValue: fetchFunction },
                { provide: JIRA_SLEEP, useValue: async () => undefined },
            ],
        })
        class TestJiraRoomModule {}

        app = await NestFactory.create(TestJiraRoomModule, { logger: logs });
        await app.listen(0, '127.0.0.1');
        base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
        rooms = app.get(RoomService);
        unsubscribers.push(rooms.onChange(({ reason }) => void changes.push(reason)));
        owner = rooms.createRoom(roomPayload({ settings: { jiraLinked: true } }));
        guest = rooms.join({ roomCode: owner.roomCode, name: 'Bia', role: 'player' });
        changes.length = 0;
    };

    const call = (
        method: string,
        path: string,
        options: { body?: unknown; authorization?: string | null; roomToken?: string | null } = {},
    ) => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const authorization = options.authorization === undefined ? `Bearer ${BLOB}` : options.authorization;
        const roomToken = options.roomToken === undefined ? owner.sessionToken : options.roomToken;
        if (authorization !== null) headers.Authorization = authorization;
        if (roomToken !== null) headers[ROOM_TOKEN_HEADER] = roomToken;
        return fetch(`${base}${path}`, {
            method,
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
    };
    const roomPath = (suffix: string, code = owner.roomCode) => `/api/jira/rooms/${code}${suffix}`;
    const errorOf = async (response: Response) => ((await response.json()) as { error: { code: string } }).error;
    const stateOf = (session: RoomSession = owner): RoomState =>
        roomStateSchema.parse(rooms.snapshot(session.roomCode, session.participantId));
    const addAgenda = (keys: string[], options = {}) =>
        call('POST', roomPath('/agenda'), { body: { type: 'keys', keys }, ...options });

    beforeEach(() => {
        logs = new LogCollector();
        atlassianRequests = [];
        atlassian = defaultAtlassian;
        grant = {};
        changes = [];
        for (const key of ['YAK-1', 'YAK-2', 'YAK-3']) issues[key] = issueJson(key);
    });

    afterEach(async () => {
        unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
        await app?.close();
    });

    describe('POST agenda', () => {
        it('resolves the keys, returns the whole agenda and fills jira in the room state for everyone', async () => {
            await start();

            const response = await addAgenda(['YAK-1', 'YAK-2']);

            expect(response.status).toBe(200);
            const { agenda } = jiraAgendaResponseSchema.parse(await response.json());
            expect(agenda.map(({ key }) => key)).toEqual(['YAK-1', 'YAK-2']);
            for (const session of [owner, guest]) {
                expect(stateOf(session).jira).toEqual({ connected: true, agenda, currentIssue: null });
            }
            expect(changes).toEqual(['jira_updated']);
        });

        it('appends to the existing agenda without duplicating keys', async () => {
            await start();
            await addAgenda(['YAK-1']);

            const response = await addAgenda(['YAK-2', 'YAK-1']);

            const { agenda } = jiraAgendaResponseSchema.parse(await response.json());
            expect(agenda.map(({ key }) => key)).toEqual(['YAK-1', 'YAK-2']);
        });

        it('accepts a JQL request', async () => {
            await start();

            const response = await call('POST', roomPath('/agenda'), {
                body: { type: 'jql', jql: 'key in (YAK-3)' },
            });

            expect(response.status).toBe(200);
            expect(jiraAgendaResponseSchema.parse(await response.json()).agenda.map(({ key }) => key)).toEqual([
                'YAK-3',
            ]);
        });

        it('keeps the agenda within the contract limit', async () => {
            await start();
            const keys = Array.from({ length: JIRA_AGENDA_MAX_ISSUES }, (_, index) => `YAK-${index + 10}`);
            keys.forEach((key) => (issues[key] = issueJson(key)));
            await addAgenda(keys);

            const response = await addAgenda(['YAK-1']);

            expect(jiraAgendaResponseSchema.parse(await response.json()).agenda).toHaveLength(JIRA_AGENDA_MAX_ISSUES);
        });

        it('rejects an invalid body with invalid_payload', async () => {
            await start();

            const response = await call('POST', roomPath('/agenda'), { body: { type: 'keys', keys: [] } });

            expect(response.status).toBe(400);
            expect((await errorOf(response)).code).toBe('invalid_payload');
        });

        it('rejects a malformed room code with invalid_payload', async () => {
            await start();

            const response = await call('POST', '/api/jira/rooms/NOPE!/agenda', {
                body: { type: 'keys', keys: ['YAK-1'] },
            });

            expect(response.status).toBe(400);
            expect((await errorOf(response)).code).toBe('invalid_payload');
        });
    });

    describe('headers', () => {
        it('sends no-store on success and on error', async () => {
            await start();

            const ok = await addAgenda(['YAK-1']);
            const failed = await addAgenda(['YAK-1'], { roomToken: null });

            expect(ok.headers.get('cache-control')).toBe('no-store');
            expect(failed.headers.get('cache-control')).toBe('no-store');
        });

        it('returns the rotated blob in X-Yak-Jira-Session', async () => {
            await start();
            grant = { refreshedBlob: 'blob-rotated' };

            const response = await addAgenda(['YAK-1']);

            expect(response.headers.get(JIRA_SESSION_HEADER)).toBe('blob-rotated');
        });

        it('does not send X-Yak-Jira-Session when the blob did not rotate', async () => {
            await start();

            const response = await addAgenda(['YAK-1']);

            expect(response.headers.get(JIRA_SESSION_HEADER)).toBeNull();
        });
    });

    describe('access control', () => {
        const endpoints: [string, string, string, unknown][] = [
            ['POST', 'agenda', '/agenda', { type: 'keys', keys: ['YAK-1'] }],
            ['DELETE', 'agenda issue', '/agenda/YAK-1', undefined],
            ['PUT', 'current issue', '/current-issue', { issueKey: 'YAK-1' }],
            ['PUT', 'size', '/issues/YAK-1/size', { value: 'M' }],
        ];

        it.each(endpoints)('%s %s answers room_not_found for an unknown room', async (method, _name, suffix, body) => {
            await start();

            const response = await call(method, roomPath(suffix, 'yak-zzzz'), { body });

            expect(response.status).toBe(404);
            expect((await errorOf(response)).code).toBe('room_not_found');
        });

        it.each(endpoints)('%s %s answers session_token_invalid without the room token', async (method, _n, suffix, body) => {
            await start();

            const response = await call(method, roomPath(suffix), { body, roomToken: null });

            expect(response.status).toBe(401);
            expect((await errorOf(response)).code).toBe('session_token_invalid');
        });

        it.each(endpoints)('%s %s answers session_token_invalid for a wrong token', async (method, _n, suffix, body) => {
            await start();

            const response = await call(method, roomPath(suffix), {
                body,
                roomToken: 'A'.repeat(43),
            });

            expect(response.status).toBe(401);
            expect((await errorOf(response)).code).toBe('session_token_invalid');
        });

        it.each(endpoints)('%s %s answers forbidden for a participant who is not the facilitator', async (method, _n, suffix, body) => {
            await start();

            const response = await call(method, roomPath(suffix), { body, roomToken: guest.sessionToken });

            expect(response.status).toBe(403);
            expect(await errorOf(response)).toEqual({ code: 'forbidden', reason: 'facilitator_only' });
        });

        it.each(endpoints)('%s %s answers jira_room_not_linked when the room has no Jira', async (method, _n, suffix, body) => {
            await start();
            rooms.updateSettings(owner.roomCode, owner.participantId, { jiraLinked: false });

            const response = await call(method, roomPath(suffix), { body });

            expect(response.status).toBe(409);
            expect((await errorOf(response)).code).toBe('jira_room_not_linked');
        });

        it.each(endpoints.filter(([method]) => method !== 'DELETE'))(
            '%s %s answers jira_reconnect_required without Authorization',
            async (method, _n, suffix, body) => {
                await start();

                const response = await call(method, roomPath(suffix), { body, authorization: null });

                expect(response.status).toBe(401);
                expect((await errorOf(response)).code).toBe('jira_reconnect_required');
            },
        );

        it('checks the room before the Jira authorization', async () => {
            await start();

            const response = await addAgenda(['YAK-1'], { roomToken: guest.sessionToken, authorization: null });

            expect(response.status).toBe(403);
        });

        it('does not call Atlassian for a refused request', async () => {
            await start();

            await addAgenda(['YAK-1'], { roomToken: guest.sessionToken });

            expect(atlassianRequests).toEqual([]);
        });
    });

    describe('DELETE agenda issue', () => {
        it('removes the key, answers 204 and updates the room state', async () => {
            await start();
            await addAgenda(['YAK-1', 'YAK-2']);
            changes.length = 0;

            const response = await call('DELETE', roomPath('/agenda/YAK-1'), { authorization: null });

            expect(response.status).toBe(204);
            expect(response.headers.get('cache-control')).toBe('no-store');
            expect(stateOf(guest).jira?.agenda.map(({ key }) => key)).toEqual(['YAK-2']);
            expect(changes).toEqual(['jira_updated']);
        });

        it('is idempotent for a key that is not in the agenda', async () => {
            await start();
            await addAgenda(['YAK-1']);
            changes.length = 0;

            const response = await call('DELETE', roomPath('/agenda/YAK-9'), { authorization: null });

            expect(response.status).toBe(204);
            expect(changes).toEqual([]);
        });

        it('answers 204 before any agenda exists', async () => {
            await start();

            const response = await call('DELETE', roomPath('/agenda/YAK-1'));

            expect(response.status).toBe(204);
            expect(stateOf().jira).toBeNull();
        });

        it('rejects a malformed issue key with invalid_payload', async () => {
            await start();

            const response = await call('DELETE', roomPath('/agenda/lixo'));

            expect(response.status).toBe(400);
            expect((await errorOf(response)).code).toBe('invalid_payload');
        });
    });

    describe('PUT current-issue', () => {
        it('loads the card, sets it as the current issue and shares it with the room', async () => {
            await start();

            const response = await call('PUT', roomPath('/current-issue'), { body: { issueKey: 'yak-2' } });

            expect(response.status).toBe(200);
            const { issue } = jiraIssueResponseSchema.parse(await response.json());
            expect(issue.key).toBe('YAK-2');
            const state = stateOf(guest);
            expect(state.jira).toMatchObject({ connected: true, currentIssue: { key: 'YAK-2' } });
            expect(state.round.issueKey).toBe('YAK-2');
            expect(rooms.getRoom(owner.roomCode).currentIssue).toEqual({ key: 'YAK-2', summary: 'Resumo YAK-2' });
        });

        it('answers jira_issue_not_found for an unknown card', async () => {
            await start();

            const response = await call('PUT', roomPath('/current-issue'), { body: { issueKey: 'YAK-99' } });

            expect(response.status).toBe(404);
            expect((await errorOf(response)).code).toBe('jira_issue_not_found');
            expect(stateOf().round.issueKey).toBeNull();
        });

        it('rejects an invalid body', async () => {
            await start();

            const response = await call('PUT', roomPath('/current-issue'), { body: { issueKey: 'x', extra: 1 } });

            expect(response.status).toBe(400);
            expect((await errorOf(response)).code).toBe('invalid_payload');
        });
    });

    describe('connected flag', () => {
        it('turns false when Jira asks to reconnect and back to true after a good call', async () => {
            await start();
            await addAgenda(['YAK-1']);
            atlassian = () => json({}, 401);

            const failed = await addAgenda(['YAK-2']);

            expect(failed.status).toBe(401);
            expect((await errorOf(failed)).code).toBe('jira_reconnect_required');
            expect(stateOf(guest).jira?.connected).toBe(false);
            expect(stateOf(guest).jira?.agenda.map(({ key }) => key)).toEqual(['YAK-1']);

            atlassian = defaultAtlassian;
            await addAgenda(['YAK-2']);

            expect(stateOf(guest).jira?.connected).toBe(true);
        });

        it('keeps the state untouched on other Jira errors', async () => {
            await start();
            await addAgenda(['YAK-1']);
            changes.length = 0;
            atlassian = () => json({}, 503);

            const failed = await addAgenda(['YAK-2']);

            expect(failed.status).toBe(502);
            expect((await errorOf(failed)).code).toBe('jira_unavailable');
            expect(stateOf().jira?.connected).toBe(true);
            expect(changes).toEqual([]);
        });
    });

    describe('PUT size', () => {
        const putSize = (value: unknown, key = 'YAK-1') =>
            call('PUT', roomPath(`/issues/${key}/size`), { body: { value } });
        const sizeWrites = () => atlassianRequests.filter(({ method, path }) => method === 'PUT' && /issue/.test(path));
        const comments = () => atlassianRequests.filter(({ path }) => path.endsWith('/comment'));

        it('saves a deck card without commenting by default', async () => {
            await start();

            const response = await putSize('M');

            expect(response.status).toBe(200);
            const body = jiraSaveSizeResponseSchema.parse(await response.json());
            expect(body.commentPosted).toBe(false);
            expect(sizeWrites()).toHaveLength(1);
            expect(comments()).toEqual([]);
        });

        it('refreshes the card in the agenda and in the current issue', async () => {
            await start();
            await addAgenda(['YAK-1']);
            await call('PUT', roomPath('/current-issue'), { body: { issueKey: 'YAK-1' } });
            issues['YAK-1'] = issueJson('YAK-1', { [SIZE_FIELD_ID]: { id: '2', value: 'M' } });

            await putSize('M');

            const { jira } = stateOf(guest);
            expect(jira?.agenda[0].size).toBe('M');
            expect(jira?.currentIssue?.size).toBe('M');
        });

        it('comments with the round result only when the room asks for it', async () => {
            await start();
            rooms.updateSettings(owner.roomCode, owner.participantId, { jiraCommentOnSave: true });
            const round = rooms.getRoom(owner.roomCode).roundId;
            rooms.vote(owner.roomCode, owner.participantId, { roundId: round, value: 'M' });
            rooms.vote(owner.roomCode, guest.participantId, { roundId: round, value: 'M' });
            rooms.reveal(owner.roomCode, owner.participantId, { roundId: round, confirmMissingVotes: false });

            const response = await putSize('M');

            expect(jiraSaveSizeResponseSchema.parse(await response.json()).commentPosted).toBe(true);
            expect(JSON.stringify(comments()[0].body)).toContain('Size definido: M');
            expect(JSON.stringify(comments()[0].body)).toContain('Consenso 100%');
        });

        it('skips the comment when nobody voted', async () => {
            await start();
            rooms.updateSettings(owner.roomCode, owner.participantId, { jiraCommentOnSave: true });

            const response = await putSize('P');

            expect(jiraSaveSizeResponseSchema.parse(await response.json()).commentPosted).toBe(false);
            expect(comments()).toEqual([]);
        });

        it.each(['?', 'yakult'])('refuses the special card %s', async (value) => {
            await start();

            const response = await putSize(value);

            expect(response.status).toBe(400);
            expect((await errorOf(response)).code).toBe('invalid_payload');
            expect(atlassianRequests).toEqual([]);
        });

        it('refuses a card that is not in the room deck', async () => {
            await start();

            const response = await putSize('GG');

            expect(response.status).toBe(400);
            expect((await errorOf(response)).code).toBe('invalid_payload');
            expect(atlassianRequests).toEqual([]);
        });

        it('passes through the Jira errors of the card', async () => {
            await start();

            const missing = await putSize('M', 'YAK-99');

            expect(missing.status).toBe(404);
            expect((await errorOf(missing)).code).toBe('jira_issue_not_found');
        });

        it('rejects an invalid body', async () => {
            await start();

            const response = await call('PUT', roomPath('/issues/YAK-1/size'), { body: { value: 'M', extra: 1 } });

            expect(response.status).toBe(400);
            expect((await errorOf(response)).code).toBe('invalid_payload');
        });
    });

    describe('secrets', () => {
        it('never logs tokens or the Jira blob', async () => {
            await start();
            atlassian = () => json({}, 503);

            await addAgenda(['YAK-1']);
            await call('PUT', roomPath('/current-issue'), { body: { issueKey: 'YAK-1' } });

            const output = logs.lines.join('\n');
            expect(output).not.toContain(BLOB);
            expect(output).not.toContain(owner.sessionToken);
            expect(output).not.toContain(guest.sessionToken);
        });

        it('does not put the Jira blob or room tokens in the room state', async () => {
            await start();
            await addAgenda(['YAK-1']);

            const serialized = JSON.stringify(stateOf(guest));

            expect(serialized).not.toContain(BLOB);
            expect(serialized).not.toContain(owner.sessionToken);
            expect(serialized).not.toContain('access-1');
        });
    });
});
