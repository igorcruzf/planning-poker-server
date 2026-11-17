import { RoomState } from '../../../contracts';
import {
    ackOf,
    createRoom,
    GatewayTestApp,
    joinRoom,
    settle,
    stateWhere,
} from '../../session/testing/gateway-test-app';
import { SocketIoTestClient } from '../../testing/socket-io-test-client';

const INSTANT_COUNTDOWN = { countdownSeconds: 0 };
const NOTHING = { ok: true, data: null };
const LONGEST_WAIT_MS = 5_000;

describe('round events over a real Socket.IO connection', () => {
    let gateway: GatewayTestApp;
    let ana: SocketIoTestClient;
    let bia: SocketIoTestClient;
    let roomCode: string;

    beforeEach(async () => {
        gateway = await GatewayTestApp.start();
        ana = await gateway.connect(undefined, LONGEST_WAIT_MS);
        bia = await gateway.connect(undefined, LONGEST_WAIT_MS);
    });

    afterEach(() => gateway.close());

    const seatBia = async (settings: Record<string, unknown> = INSTANT_COUNTDOWN) => {
        ({ roomCode } = await createRoom(ana, { settings }));
        await joinRoom(bia, roomCode, 'Bia');
        await stateWhere(ana, (state) => state.participants.length === 2);
        await stateWhere(bia);
    };
    const vote = (client: SocketIoTestClient, value: string | null, roundId = 1) =>
        ackOf(client, 'round:vote', { roundId, value });
    const reveal = (client: SocketIoTestClient, confirmMissingVotes?: boolean, roundId = 1) =>
        ackOf(client, 'round:reveal', { roundId, ...(confirmMissingVotes === undefined ? {} : { confirmMissingVotes }) });

    it('runs create, join, vote, reveal, reset and finalize', async () => {
        await seatBia();
        expect(await vote(ana, 'PP')).toEqual(NOTHING);
        expect(await vote(bia, 'GG'.slice(0, 1))).toEqual(NOTHING);
        expect(await reveal(ana)).toEqual(NOTHING);
        const revealed = await stateWhere(bia, (state) => state.round.phase === 'revealed');
        expect(revealed.round.phase === 'revealed' && revealed.round.votes.map(({ value }) => value).sort()).toEqual([
            'G',
            'PP',
        ]);
        expect(await ackOf(ana, 'round:finalize', { roundId: 1, value: 'M' })).toEqual(NOTHING);
        const finalized = await stateWhere(ana, (state) => state.history[0]?.finalEstimate != null);
        expect(finalized.history[0].finalEstimate?.value).toBe('M');
        expect(await ackOf(ana, 'round:reset', { roundId: 1 })).toEqual(NOTHING);
        const reset = await stateWhere(bia, (state) => state.round.id === 2);
        expect(reset.round.phase).toBe('voting');
        expect(reset.self.vote).toBeNull();
    });

    it('sends each socket its own vote and never the vote of the other before the reveal', async () => {
        await seatBia();
        await vote(ana, 'PP');
        await vote(bia, 'G');
        const everyoneVoted = (state: RoomState) => state.participants.every(({ hasVoted }) => hasVoted);
        const stateOfAna = await stateWhere(ana, everyoneVoted);
        const stateOfBia = await stateWhere(bia, everyoneVoted);
        expect(stateOfAna.self.vote).toBe('PP');
        expect(stateOfBia.self.vote).toBe('G');
        const tableOf = ({ round, participants, history }: RoomState) => JSON.stringify({ round, participants, history });
        expect(tableOf(stateOfAna)).not.toMatch(/"(PP|G)"/);
        expect(tableOf(stateOfBia)).not.toMatch(/"(PP|G)"/);
    });

    it('lets a vote be withdrawn with null', async () => {
        await seatBia();
        await vote(ana, 'PP');
        expect(await vote(ana, null)).toEqual(NOTHING);
        const state = await stateWhere(ana, (candidate) => candidate.self.vote === null);
        expect(state.participants.find(({ name }) => name === 'Ana')?.hasVoted).toBe(false);
    });

    it('answers invalid_vote for a card outside the deck and wrong_phase after the reveal', async () => {
        await seatBia();
        expect(await vote(ana, 'ZZ')).toEqual({ ok: false, error: { code: 'invalid_vote' } });
        await vote(ana, 'PP');
        await vote(bia, 'P');
        await reveal(ana);
        expect(await vote(ana, 'M')).toEqual({ ok: false, error: { code: 'wrong_phase', phase: 'revealed' } });
    });

    it('answers round_stale for a round that is not the current one', async () => {
        await seatBia();
        expect(await vote(ana, 'PP', 7)).toEqual({ ok: false, error: { code: 'round_stale' } });
        expect(await reveal(ana, undefined, 7)).toEqual({ ok: false, error: { code: 'round_stale' } });
        expect(await ackOf(ana, 'round:reset', { roundId: 7 })).toEqual({ ok: false, error: { code: 'round_stale' } });
    });

    describe('reveal (D8)', () => {
        it('lets any player reveal when everybody voted', async () => {
            await seatBia();
            await vote(ana, 'PP');
            await vote(bia, 'P');
            expect(await reveal(bia)).toEqual(NOTHING);
            await stateWhere(ana, (state) => state.round.phase === 'revealed');
        });

        it('is idempotent when the same round is revealed again', async () => {
            await seatBia();
            await vote(ana, 'PP');
            await vote(bia, 'P');
            await reveal(ana);
            expect(await reveal(bia)).toEqual(NOTHING);
        });

        it('refuses a player who is not the facilitator when a vote is missing', async () => {
            await seatBia();
            await vote(ana, 'PP');
            expect(await reveal(bia, true)).toEqual({ ok: false, error: { code: 'forbidden', reason: 'facilitator_only' } });
        });

        it('asks the facilitator to confirm when a vote is missing', async () => {
            await seatBia();
            await vote(ana, 'PP');
            const ack = await reveal(ana);
            expect(ack).toEqual({
                ok: false,
                error: { code: 'votes_pending', missing: [{ participantId: expect.any(String), name: 'Bia' }] },
            });
        });

        it('reveals with the confirmation of the facilitator', async () => {
            await seatBia();
            await vote(ana, 'PP');
            expect(await reveal(ana, true)).toEqual(NOTHING);
            await stateWhere(bia, (state) => state.round.phase === 'revealed');
        });

        it('refuses a spectator', async () => {
            await seatBia();
            await ackOf(bia, 'room:setRole', { role: 'spectator' });
            await vote(ana, 'PP');
            expect(await reveal(bia)).toEqual({ ok: false, error: { code: 'forbidden', reason: 'players_only' } });
        });

        it('counts the countdown before showing the votes', async () => {
            await seatBia({ countdownSeconds: 3 });
            await vote(ana, 'PP');
            await vote(bia, 'P');
            await reveal(ana);
            const counting = await stateWhere(bia, (state) => state.round.phase === 'countdown');
            expect(counting.round).toMatchObject({ phase: 'countdown', countdownMs: 3_000 });
            expect(JSON.stringify(counting)).not.toContain('"votes"');
            const revealed = await stateWhere(bia, (state) => state.round.phase === 'revealed');
            expect(revealed.round.phase).toBe('revealed');
        }, 10_000);
    });

    describe('finalize', () => {
        it('refuses a player who is not the facilitator', async () => {
            await seatBia();
            await vote(ana, 'PP');
            await vote(bia, 'P');
            await reveal(ana);
            expect(await ackOf(bia, 'round:finalize', { roundId: 1, value: 'M' })).toEqual({
                ok: false,
                error: { code: 'forbidden', reason: 'facilitator_only' },
            });
        });

        it('answers wrong_phase before the reveal', async () => {
            await seatBia();
            expect(await ackOf(ana, 'round:finalize', { roundId: 1, value: 'M' })).toEqual({
                ok: false,
                error: { code: 'wrong_phase', phase: 'voting' },
            });
        });

        it('rejects the special cards as the final estimate', async () => {
            await seatBia();
            expect(await ackOf(ana, 'round:finalize', { roundId: 1, value: '?' })).toMatchObject({
                ok: false,
                error: { code: 'invalid_payload' },
            });
        });
    });

    it('does not let a socket act on the round of another room', async () => {
        await seatBia();
        const caio = await gateway.connect();
        const other = await createRoom(caio, { participantName: 'Caio', settings: INSTANT_COUNTDOWN });
        await stateWhere(caio);
        expect(await vote(caio, 'M')).toEqual(NOTHING);
        expect(await reveal(caio, true)).toEqual(NOTHING);
        await stateWhere(caio, (state) => state.round.phase === 'revealed');
        await settle();
        expect(other.roomCode).not.toBe(roomCode);
        expect(ana.queued('room:state')).toEqual([]);
        expect(bia.queued('room:state')).toEqual([]);
    });

    it('answers invalid_payload without echoing a bad round vote', async () => {
        await seatBia();
        const ack = await ackOf(ana, 'round:vote', { roundId: 'segredo-do-cliente', value: 'PP' });
        expect(ack).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
        expect(JSON.stringify(ack)).not.toContain('segredo-do-cliente');
    });
});
