import { Logger } from '@nestjs/common';
import {
    MCP_CALL_LIMIT,
    MCP_MAX_BODY_BYTES,
    MCP_MAX_SESSIONS,
    MCP_MAX_SESSIONS_PER_ADDRESS,
    MCP_MAX_UNSEATED_PER_ADDRESS,
    MCP_SESSION_IDLE_MS,
    MCP_UNSEATED_SESSION_MS,
} from './mcp-limits';
import { callTool, errorOf, McpTestApp } from './testing/mcp-test-app';
const INITIALIZE = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'raw', version: '1.0.0' } },
};
const MCP_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
describe('MCP endpoint limits', () => {
    let world: McpTestApp;
    beforeEach(async () => {
        world = await McpTestApp.start();
    });
    afterEach(() => world.close());
    const post = (body: unknown, headers: Record<string, string> = {}) =>
        fetch(world.mcpUrl, { method: 'POST', headers: { ...MCP_HEADERS, ...headers }, body: JSON.stringify(body) });
    const seatedKiro = async () => {
        const ana = await world.socket();
        const { roomCode } = await world.createRoomWithKiro(ana);
        const kiro = await world.connectMcp();
        await callTool(kiro, 'join_table', { invite: await world.inviteOf(ana) });
        return { ana, kiro, roomCode };
    };
    it('rate limits the calls of one session without affecting another', async () => {
        const { kiro } = await seatedKiro();
        const other = await world.connectMcp();
        for (let call = 0; call < MCP_CALL_LIMIT.limit - 1; call += 1) await callTool(kiro, 'get_round');
        const blocked = await callTool(kiro, 'get_round');
        expect(errorOf(blocked)).toMatchObject({ code: 'rate_limited', retryAfterMs: expect.any(Number) });
        expect(errorOf(await callTool(other, 'get_round'))).toEqual({ code: 'forbidden', reason: 'not_in_room' });
        world.clock.advance(MCP_CALL_LIMIT.windowMs);
        expect((await callTool(kiro, 'get_round')).isError).toBeUndefined();
    });
    it('limits join attempts per session so an invite cannot be guessed', async () => {
        const kiro = await world.connectMcp();
        for (let attempt = 0; attempt < 5; attempt += 1) {
            expect(errorOf(await callTool(kiro, 'join_table', { invite: 'a'.repeat(43) }))).toEqual({
                code: 'invite_invalid',
            });
        }
        expect(errorOf(await callTool(kiro, 'join_table', { invite: 'a'.repeat(43) }))).toMatchObject({
            code: 'rate_limited',
        });
    });
    const fromAddress = (index: number) => ({
        'X-Forwarded-For': `10.${Math.floor(index / 250)}.${index % 250}.1`,
    });
    it('limits new sessions per address', async () => {
        for (let attempt = 0; attempt < 10; attempt += 1) await post(INITIALIZE);
        const blocked = await post(INITIALIZE);
        expect(blocked.status).toBe(429);
        expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    });
    it('limits the simultaneous sessions of one address', async () => {
        expect(MCP_MAX_SESSIONS_PER_ADDRESS).toBe(3);
        expect(MCP_MAX_UNSEATED_PER_ADDRESS).toBe(5);
        for (let opened = 0; opened < MCP_MAX_SESSIONS_PER_ADDRESS; opened += 1) {
            expect((await post(INITIALIZE)).status).toBe(200);
        }
        expect((await post(INITIALIZE)).status).toBe(429);
        expect((await post(INITIALIZE, fromAddress(1))).status).toBe(200);
    });
    it('frees the address quota when its sessions end', async () => {
        for (let opened = 0; opened < MCP_MAX_SESSIONS_PER_ADDRESS; opened += 1) await post(INITIALIZE);
        world.scheduler.advance(MCP_UNSEATED_SESSION_MS);
        expect((await post(INITIALIZE)).status).toBe(200);
    });
    it('limits the number of simultaneous sessions', async () => {
        for (let opened = 0; opened < MCP_MAX_SESSIONS; opened += 1) {
            expect((await post(INITIALIZE, fromAddress(opened))).status).toBe(200);
        }
        expect(world.hub.openSessions).toBe(MCP_MAX_SESSIONS);
        expect((await post(INITIALIZE, fromAddress(MCP_MAX_SESSIONS))).status).toBe(503);
    });
    it('expires a session that never joined a table after 60 seconds', async () => {
        expect(MCP_UNSEATED_SESSION_MS).toBe(60_000);
        await world.connectMcp();
        world.scheduler.advance(MCP_UNSEATED_SESSION_MS - 1);
        expect(world.hub.openSessions).toBe(1);
        world.scheduler.advance(1);
        expect(world.hub.openSessions).toBe(0);
    });
    it('switches a session to the normal idle expiry once it joins', async () => {
        const { roomCode } = await seatedKiro();
        world.scheduler.advance(MCP_UNSEATED_SESSION_MS);
        expect(world.hub.openSessions).toBe(1);
        world.scheduler.advance(MCP_SESSION_IDLE_MS - MCP_UNSEATED_SESSION_MS);
        expect(world.hub.openSessions).toBe(0);
        expect(world.rooms.snapshot(roomCode, null).participants.every(({ role }) => role !== 'bot')).toBe(true);
    });
    it('refuses a body above the maximum', async () => {
        const response = await post({ ...INITIALIZE, padding: 'x'.repeat(MCP_MAX_BODY_BYTES) });
        expect(response.status).toBe(413);
    });
    it('answers 404 for an unknown session and 400 without a session', async () => {
        expect((await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-session-id': 'nope' })).status).toBe(
            404,
        );
        expect((await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).status).toBe(400);
        expect((await fetch(world.mcpUrl, { method: 'GET', headers: { Accept: 'text/event-stream' } })).status).toBe(
            400,
        );
        expect((await fetch(world.mcpUrl, { method: 'DELETE' })).status).toBe(400);
    });
    it('frees the seat of a session that stays idle', async () => {
        const { roomCode } = await seatedKiro();
        expect(world.hub.openSessions).toBe(1);
        world.scheduler.advance(MCP_SESSION_IDLE_MS);
        expect(world.hub.openSessions).toBe(0);
        const { participants } = world.rooms.snapshot(roomCode, null);
        expect(participants.every(({ role }) => role !== 'bot')).toBe(true);
    });
    it('keeps the session alive while it is used', async () => {
        const { kiro } = await seatedKiro();
        world.scheduler.advance(MCP_SESSION_IDLE_MS - 1);
        await callTool(kiro, 'get_round');
        world.scheduler.advance(MCP_SESSION_IDLE_MS - 1);
        expect(world.hub.openSessions).toBe(1);
    });
    it('never logs invites, votes, rationales or session ids', async () => {
        const logged: string[] = [];
        const record = (...args: unknown[]) => logged.push(args.map(String).join(' '));
        const spies = (['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const).map((level) =>
            jest.spyOn(Logger.prototype, level).mockImplementation(record),
        );
        const consoleSpies = (['log', 'info', 'warn', 'error'] as const).map((level) =>
            jest.spyOn(console, level).mockImplementation(record),
        );
        try {
            const ana = await world.socket();
            await world.createRoomWithKiro(ana);
            const invite = await world.inviteOf(ana);
            const kiro = await world.connectMcp();
            await callTool(kiro, 'join_table', { invite });
            await callTool(kiro, 'cast_vote', { value: 'PP', rationale: 'segredo-da-justificativa' });
            await callTool(kiro, 'leave_table');
            world.scheduler.advance(0);
            const output = logged.join('\n');
            expect(output).not.toContain(invite);
            expect(output).not.toContain('segredo-da-justificativa');
            expect(output).not.toContain('PP');
        } finally {
            [...spies, ...consoleSpies].forEach((spy) => spy.mockRestore());
        }
    });
});
