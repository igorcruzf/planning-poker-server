import { DISCONNECTED_PLAYER_GRACE_MS, RoomState } from '../../contracts';
import { SocketIoTestClient } from '../testing/socket-io-test-client';
import { ackOf, createRoom, GatewayTestApp, joinRoom, stateWhere } from './testing/gateway-test-app';

const REAL_APIS = [
    'hrtime',
    'nextTick',
    'performance',
    'queueMicrotask',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'requestIdleCallback',
    'cancelIdleCallback',
    'setImmediate',
    'clearImmediate',
    'setInterval',
    'clearInterval',
] as const;

const isRevealed = (state: RoomState) => state.round.phase === 'revealed';

describe('presence timers over a real Socket.IO connection', () => {
    let gateway: GatewayTestApp;
    let ana: SocketIoTestClient;
    let bia: SocketIoTestClient;
    let roomCode: string;
    let biaSession: { sessionToken: string };

    beforeEach(async () => {
        jest.useFakeTimers({ doNotFake: [...REAL_APIS], now: Date.now() });
        gateway = await GatewayTestApp.start();
        ana = await gateway.connect();
        bia = await gateway.connect();
        ({ roomCode } = await createRoom(ana, {
            settings: { autoReveal: true, countdownSeconds: 0 },
        }));
        biaSession = await joinRoom(bia, roomCode, 'Bia');
        await ackOf(ana, 'round:vote', { roundId: 1, value: 'PP' });
        await stateWhere(ana, (state) => state.participants.length === 2 && state.self.vote === 'PP');
        await bia.close();
        await stateWhere(ana, (state) => state.participants.some(({ presence }) => presence === 'disconnected'));
    });

    afterEach(async () => {
        await gateway.close();
        jest.useRealTimers();
    });

    it('settles the round when the 30 s of the missing voter run out', async () => {
        jest.advanceTimersByTime(DISCONNECTED_PLAYER_GRACE_MS - 1);
        await ackOf(ana, 'round:vote', { roundId: 1, value: 'PP' });
        expect(
            ana
                .queued('room:state')
                .map(([state]) => state as RoomState)
                .some(isRevealed),
        ).toBe(false);
        jest.advanceTimersByTime(1);
        const state = await stateWhere(ana, isRevealed);
        expect(state.round.phase).toBe('revealed');
    });

    it('keeps the round open when the voter reconnects with the token before the 30 s', async () => {
        jest.advanceTimersByTime(10_000);
        const back = await gateway.connect();
        await joinRoom(back, roomCode, 'Bia', {
            sessionToken: biaSession.sessionToken,
        });
        await stateWhere(ana, (state) => state.participants.every(({ presence }) => presence === 'connected'));
        jest.advanceTimersByTime(DISCONNECTED_PLAYER_GRACE_MS * 2);
        await ackOf(ana, 'round:vote', { roundId: 1, value: 'PP' });
        expect(
            ana
                .queued('room:state')
                .map(([state]) => state as RoomState)
                .some(isRevealed),
        ).toBe(false);
    });
});
describe('presence timers over a real Socket.IO connection without auto reveal', () => {
    let gateway: GatewayTestApp;
    let ana: SocketIoTestClient;
    let bia: SocketIoTestClient;
    let caioId: string;
    const withoutCaio = (state: RoomState) =>
        state.round.phase === 'voting' && state.round.pendingVoterIds.length === 0;
    beforeEach(async () => {
        jest.useFakeTimers({ doNotFake: [...REAL_APIS], now: Date.now() });
        gateway = await GatewayTestApp.start();
        ana = await gateway.connect();
        bia = await gateway.connect();
        const caio = await gateway.connect();
        const { roomCode } = await createRoom(ana, { settings: { autoReveal: false, countdownSeconds: 0 } });
        await joinRoom(bia, roomCode, 'Bia');
        ({ participantId: caioId } = await joinRoom(caio, roomCode, 'Caio'));
        await ackOf(ana, 'round:vote', { roundId: 1, value: 'PP' });
        await ackOf(bia, 'round:vote', { roundId: 1, value: 'P' });
        await caio.close();
        await stateWhere(bia, (state) => state.participants.some(({ presence }) => presence === 'disconnected'));
    });
    afterEach(async () => {
        await gateway.close();
        jest.useRealTimers();
    });
    it('drops the missing voter from the pending list at 30 s and lets a regular player reveal', async () => {
        jest.advanceTimersByTime(DISCONNECTED_PLAYER_GRACE_MS);
        const [anaState, biaState] = await Promise.all([stateWhere(ana, withoutCaio), stateWhere(bia, withoutCaio)]);
        expect(anaState.round.phase === 'voting' && anaState.round.pendingVoterIds).not.toContain(caioId);
        expect(biaState.participants.some(({ id }) => id === caioId)).toBe(true);
        const reveal = await ackOf(bia, 'round:reveal', { roundId: 1, confirmMissingVotes: false });
        expect(reveal.ok).toBe(true);
        expect((await stateWhere(bia, isRevealed)).round.phase).toBe('revealed');
    });
});
