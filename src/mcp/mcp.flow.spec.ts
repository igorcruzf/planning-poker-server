import { KIRO_TOOL_NAMES, RoomState } from '../contracts';
import { SocketIoTestClient } from '../gateway/testing/socket-io-test-client';
import { callTool, errorOf, McpTestApp } from './testing/mcp-test-app';
const stateWhere = async (client: SocketIoTestClient, predicate: (state: RoomState) => boolean) => {
    for (;;) {
        const state = (await client.waitFor('room:state')) as RoomState;
        if (predicate(state)) return state;
    }
};
describe('Kiro at the table over a real MCP client', () => {
    let world: McpTestApp;
    beforeEach(async () => {
        world = await McpTestApp.start();
    });
    afterEach(() => world.close());
    it('publishes the five tools with the contract schemas', async () => {
        const kiro = await world.connectMcp();
        const { tools } = await kiro.listTools();
        expect(tools.map(({ name }) => name).sort()).toEqual([...KIRO_TOOL_NAMES].sort());
        const waitTool = tools.find(({ name }) => name === 'wait_for_round');
        expect(JSON.stringify(waitTool?.inputSchema)).toContain('"maximum":90');
        expect(tools.every((tool) => tool.outputSchema?.type === 'object')).toBe(true);
    });
    it('runs invite, join_table, get_round, cast_vote and the reveal without the Kiro seeing the other votes', async () => {
        const ana = await world.socket();
        const bia = await world.socket();
        const { roomCode } = await world.createRoomWithKiro(ana);
        await world.ackData(bia, 'room:join', { roomCode, name: 'Bia' });
        const invite = await world.inviteOf(ana);
        const kiro = await world.connectMcp();
        const joined = await callTool(kiro, 'join_table', { invite });
        expect(joined.structuredContent).toMatchObject({ seatName: 'Kiro do Ana', roomName: 'Sprint' });
        await world.ackData(ana, 'round:vote', { roundId: 1, value: 'PP' });
        await world.ackData(bia, 'round:vote', { roundId: 1, value: 'G' });
        const looked = await callTool(kiro, 'get_round');
        expect(looked.structuredContent).toMatchObject({ round: { id: 1, phase: 'voting' }, yourVote: null });
        expect(JSON.stringify(looked)).not.toContain('Bia');
        const voted = await callTool(kiro, 'cast_vote', { value: 'M', rationale: 'Parece de tamanho médio' });
        expect(voted.structuredContent).toEqual({ roundId: 1, value: 'M', rationale: 'Parece de tamanho médio' });
        const anaView = await stateWhere(ana, (state) =>
            state.participants.some((p) => p.role === 'bot' && p.hasVoted),
        );
        expect(JSON.stringify(anaView)).not.toContain('Parece de tamanho médio');
        await world.ackData(ana, 'round:reveal', { roundId: 1 });
        const revealed = await stateWhere(ana, (state) => state.round.phase === 'revealed');
        expect(revealed.round.phase === 'revealed' && revealed.round.kiroGuesses).toMatchObject([
            { name: 'Kiro do Ana', value: 'M', rationale: 'Parece de tamanho médio' },
        ]);
        const after = await callTool(kiro, 'get_round');
        expect(after.structuredContent).toMatchObject({
            round: { id: 1, phase: 'revealed', finalEstimate: null },
            yourVote: { value: 'M' },
        });
        const votes = (after.structuredContent?.round as { votes: { name: string; value: string }[] }).votes;
        expect([...votes].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
            { name: 'Ana', value: 'PP' },
            { name: 'Bia', value: 'G' },
        ]);
    });
    it('answers an error without detail for tools called before join_table', async () => {
        const kiro = await world.connectMcp();
        for (const name of ['get_round', 'cast_vote', 'leave_table']) {
            const args = name === 'cast_vote' ? { value: 'PP', rationale: 'x' } : {};
            expect(errorOf(await callTool(kiro, name, args))).toEqual({ code: 'forbidden', reason: 'not_in_room' });
        }
        expect(errorOf(await callTool(kiro, 'wait_for_round', { timeout_s: 1 }))).toEqual({
            code: 'forbidden',
            reason: 'not_in_room',
        });
    });
    it('refuses an invalid, malformed or reused invite', async () => {
        const ana = await world.socket();
        await world.createRoomWithKiro(ana);
        const invite = await world.inviteOf(ana);
        const first = await world.connectMcp();
        const second = await world.connectMcp();
        expect(errorOf(await callTool(first, 'join_table', { invite: 'a'.repeat(43) }))).toEqual({
            code: 'invite_invalid',
        });
        expect(await callTool(first, 'join_table', { invite: 'curto' })).toMatchObject({ isError: true });
        expect((await callTool(first, 'join_table', { invite })).isError).toBeUndefined();
        expect(errorOf(await callTool(second, 'join_table', { invite }))).toEqual({ code: 'invite_invalid' });
    });
    it('refuses an expired invite', async () => {
        const ana = await world.socket();
        await world.createRoomWithKiro(ana);
        const invite = await world.inviteOf(ana);
        const originalNow = Date.now;
        Date.now = () => originalNow() + 10 * 60 * 1000 + 1;
        try {
            const kiro = await world.connectMcp();
            expect(errorOf(await callTool(kiro, 'join_table', { invite }))).toEqual({ code: 'invite_invalid' });
        } finally {
            Date.now = originalNow;
        }
    });
    it('rejects a participantId, an unknown field and values above the limits', async () => {
        const ana = await world.socket();
        await world.createRoomWithKiro(ana);
        const kiro = await world.connectMcp();
        await callTool(kiro, 'join_table', { invite: await world.inviteOf(ana) });
        const attempts: [string, Record<string, unknown>][] = [
            ['cast_vote', { value: 'PP', rationale: 'a', participantId: 'p-x' }],
            ['cast_vote', { value: 'PP', rationale: 'a'.repeat(281) }],
            ['wait_for_round', { timeout_s: 91 }],
            ['get_round', { participantId: 'p-x' }],
        ];
        for (const [name, args] of attempts) {
            const result = await callTool(kiro, name, args);
            expect(result.isError).toBe(true);
            expect(result.content?.[0]?.text).toContain('Input validation error');
        }
        expect((await callTool(kiro, 'get_round')).structuredContent?.yourVote).toBeNull();
    });
    it('keeps each MCP session on its own seat', async () => {
        const ana = await world.socket();
        const bia = await world.socket();
        const { roomCode } = await world.createRoomWithKiro(ana);
        await world.ackData(bia, 'room:join', { roomCode, name: 'Bia' });
        const kiroA = await world.connectMcp();
        const kiroB = await world.connectMcp();
        await callTool(kiroA, 'join_table', { invite: await world.inviteOf(ana) });
        await callTool(kiroB, 'join_table', { invite: await world.inviteOf(bia) });
        await callTool(kiroA, 'cast_vote', { value: 'PP', rationale: 'a' });
        await callTool(kiroB, 'cast_vote', { value: 'G', rationale: 'b' });
        expect((await callTool(kiroA, 'get_round')).structuredContent?.yourVote).toEqual({
            value: 'PP',
            rationale: 'a',
        });
        expect((await callTool(kiroB, 'get_round')).structuredContent?.yourVote).toEqual({
            value: 'G',
            rationale: 'b',
        });
        await callTool(kiroA, 'leave_table');
        world.scheduler.advance(0);
        expect((await callTool(kiroB, 'get_round')).structuredContent?.yourVote).toEqual({
            value: 'G',
            rationale: 'b',
        });
    });
    it('names the seats "Kiro do {dono}" for different owners', async () => {
        const ana = await world.socket();
        const bia = await world.socket();
        const { roomCode } = await world.createRoomWithKiro(ana);
        await world.ackData(bia, 'room:join', { roomCode, name: 'Bia' });
        const kiroA = await world.connectMcp();
        const kiroB = await world.connectMcp();
        const a = await callTool(kiroA, 'join_table', { invite: await world.inviteOf(ana) });
        const b = await callTool(kiroB, 'join_table', { invite: await world.inviteOf(bia) });
        expect([a.structuredContent?.seatName, b.structuredContent?.seatName]).toEqual(['Kiro do Ana', 'Kiro do Bia']);
    });
    it('frees the seat on leave_table and drops the MCP session', async () => {
        const ana = await world.socket();
        await world.createRoomWithKiro(ana);
        const kiro = await world.connectMcp();
        await callTool(kiro, 'join_table', { invite: await world.inviteOf(ana) });
        const left = await callTool(kiro, 'leave_table');
        expect(left.structuredContent).toEqual({ left: true });
        world.scheduler.advance(0);
        expect(world.hub.openSessions).toBe(0);
        const state = await stateWhere(ana, (current) => current.participants.length === 1);
        expect(state.participants.map(({ role }) => role)).toEqual(['player']);
        await expect(callTool(kiro, 'get_round')).rejects.toThrow();
    });
    it('frees the seat when the client ends the MCP session', async () => {
        const ana = await world.socket();
        await world.createRoomWithKiro(ana);
        const kiro = await world.connectMcp();
        await callTool(kiro, 'join_table', { invite: await world.inviteOf(ana) });
        await kiro.transport?.terminateSession?.();
        await kiro.close();
        const state = await stateWhere(ana, (current) => current.participants.length === 1);
        expect(state.participants.every(({ role }) => role !== 'bot')).toBe(true);
        expect(world.hub.openSessions).toBe(0);
    });
    it('wakes wait_for_round on a new round and times out at 90 s with a fake clock', async () => {
        const ana = await world.socket();
        const { roomCode } = await world.createRoomWithKiro(ana);
        const kiro = await world.connectMcp();
        await callTool(kiro, 'join_table', { invite: await world.inviteOf(ana) });
        const waiting = callTool(kiro, 'wait_for_round', { timeout_s: 90 });
        await world.ackData(ana, 'round:vote', { roundId: 1, value: 'PP' });
        await world.ackData(ana, 'round:reveal', { roundId: 1 });
        await world.ackData(ana, 'round:reset', { roundId: 1 });
        const woke = await waiting;
        expect(woke.structuredContent).toMatchObject({ change: 'new_round', round: { id: 2, phase: 'voting' } });
        expect(roomCode).toBeDefined();
        const lonely = callTool(kiro, 'wait_for_round', { timeout_s: 90 });
        await new Promise((resolve) => setTimeout(resolve, 100));
        world.scheduler.advance(90_000);
        expect((await lonely).structuredContent).toMatchObject({ change: 'timeout' });
    });
});
