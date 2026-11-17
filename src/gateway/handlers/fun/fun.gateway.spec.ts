import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
    Ack,
    FUN_REACTION_WINDOW_MS,
    FUN_REACTIONS_PER_WINDOW,
    FUN_SEED_MAX,
    FUN_THROW_WINDOW_MS,
    FUN_THROWS_PER_WINDOW,
    FunReacted,
    FunThrown,
    PROTOCOL_VERSION,
    RoomSession,
    RoomState,
} from '../../../contracts';
import { RoomService } from '../../../domain/room.service';
import { GatewayModule } from '../../gateway.module';
import { SocketIoTestClient, socketIoUrl } from '../../testing/socket-io-test-client';
import { roomArea } from '../room';
import { funArea } from './index';

@Module({ imports: [GatewayModule.forAreas([roomArea, funArea])] })
class FunGatewayTestModule {}

const QUIET_PERIOD_MS = 150;
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

describe('fun events over a real Socket.IO connection', () => {
    let app: INestApplication;
    let ana: SocketIoTestClient;
    let bia: SocketIoTestClient;
    let anaSession: RoomSession;
    let biaSession: RoomSession;
    const clients: SocketIoTestClient[] = [];

    const connect = async () => {
        const client = await SocketIoTestClient.connect(socketIoUrl(app), {
            auth: { protocolVersion: PROTOCOL_VERSION },
            timeoutMs: 5_000,
        });
        clients.push(client);
        return client;
    };
    const ack = (client: SocketIoTestClient, event: string, payload: unknown) =>
        client.emitWithAck(event, payload) as Promise<Ack<unknown>>;
    const dataOf = async <T>(client: SocketIoTestClient, event: string, payload: unknown) => {
        const response = await ack(client, event, payload);
        if (!response.ok) throw new Error(`${event} failed with ${response.error.code}`);
        return response.data as T;
    };
    const seatedCount = async (client: SocketIoTestClient, count: number) => {
        for (;;) {
            const state = (await client.waitFor('room:state')) as RoomState;
            if (state.participants.length === count) return state;
        }
    };
    const throwAt = (client: SocketIoTestClient, targetId: string) => ack(client, 'fun:throw', { targetId });

    beforeEach(async () => {
        app = await NestFactory.create(FunGatewayTestModule, { logger: false });
        await app.listen(0);
        ana = await connect();
        bia = await connect();
        anaSession = await dataOf<RoomSession>(ana, 'room:create', {
            roomName: 'Sprint',
            participantName: 'Ana',
            settings: { allowKiro: true },
        });
        biaSession = await dataOf<RoomSession>(bia, 'room:join', { roomCode: anaSession.roomCode, name: 'Bia' });
        await seatedCount(ana, 2);
        await seatedCount(bia, 2);
    });

    afterEach(async () => {
        await Promise.allSettled(clients.splice(0).map((client) => client.close()));
        await app.close();
    });

    describe('fun:throw', () => {
        it('emits fun:thrown to the whole table with a server-made seed and the sender from the session', async () => {
            const before = Date.now();

            const response = await throwAt(ana, biaSession.participantId);
            const [toAna, toBia] = (await Promise.all([ana.waitFor('fun:thrown'), bia.waitFor('fun:thrown')])) as FunThrown[];

            expect(response).toEqual({ ok: true, data: null });
            expect(toBia).toEqual(toAna);
            expect(toAna).toMatchObject({
                fromId: anaSession.participantId,
                targetId: biaSession.participantId,
                blockedByUmbrella: false,
            });
            expect(toAna.id.length).toBeGreaterThan(0);
            expect(Number.isInteger(toAna.seed)).toBe(true);
            expect(toAna.seed).toBeGreaterThanOrEqual(0);
            expect(toAna.seed).toBeLessThanOrEqual(FUN_SEED_MAX);
            expect(toAna.thrownAt).toBeGreaterThanOrEqual(before);
        });

        it('gives each throw its own id', async () => {
            await throwAt(ana, biaSession.participantId);
            await throwAt(ana, biaSession.participantId);

            const first = (await bia.waitFor('fun:thrown')) as FunThrown;
            const second = (await bia.waitFor('fun:thrown')) as FunThrown;

            expect(first.id).not.toBe(second.id);
        });

        it('lets a participant throw at a Kiro seat', async () => {
            const rooms = app.get(RoomService, { strict: false });
            const { inviteCode } = rooms.createKiroInvite(anaSession.roomCode, anaSession.participantId);
            const kiro = rooms.redeemKiroInvite(inviteCode);

            const response = await throwAt(bia, kiro.participantId);

            expect(response).toEqual({ ok: true, data: null });
            expect(await ana.waitFor('fun:thrown')).toMatchObject({ targetId: kiro.participantId });
        });

        it('refuses to throw at oneself with invalid_target', async () => {
            expect(await throwAt(ana, anaSession.participantId)).toMatchObject({
                ok: false,
                error: { code: 'invalid_target' },
            });
        });

        it('refuses a target that does not exist with invalid_target', async () => {
            expect(await throwAt(ana, 'p-ghost')).toMatchObject({ ok: false, error: { code: 'invalid_target' } });
        });

        it('refuses a participant from another room as target', async () => {
            const carla = await connect();
            const other = await dataOf<RoomSession>(carla, 'room:create', { roomName: 'Outra', participantName: 'Carla' });

            expect(await throwAt(ana, other.participantId)).toMatchObject({ ok: false, error: { code: 'invalid_target' } });
        });

        it('refuses a socket without a seat with forbidden not_in_room', async () => {
            const visitor = await connect();

            expect(await throwAt(visitor, biaSession.participantId)).toMatchObject({
                ok: false,
                error: { code: 'forbidden', reason: 'not_in_room' },
            });
        });

        it('refuses a payload with a sender or extra field', async () => {
            const response = await ack(ana, 'fun:throw', { targetId: biaSession.participantId, fromId: 'p-x' });

            expect(response).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
        });

        it('allows 3 throws per 5 s and answers the 4th with rate_limited and retryAfterMs', async () => {
            for (let throws = 0; throws < FUN_THROWS_PER_WINDOW; throws += 1) {
                expect(await throwAt(ana, biaSession.participantId)).toEqual({ ok: true, data: null });
            }

            const limited = (await throwAt(ana, biaSession.participantId)) as {
                ok: false;
                error: { code: string; retryAfterMs: number };
            };

            expect(limited.error.code).toBe('rate_limited');
            expect(limited.error.retryAfterMs).toBeGreaterThan(0);
            expect(limited.error.retryAfterMs).toBeLessThanOrEqual(FUN_THROW_WINDOW_MS);
        });

        it('keeps the throw limit per participant, not shared with the table', async () => {
            for (let throws = 0; throws < FUN_THROWS_PER_WINDOW; throws += 1) await throwAt(ana, biaSession.participantId);

            expect(await throwAt(bia, anaSession.participantId)).toEqual({ ok: true, data: null });
        });

        it('does not spend the limit on refused targets', async () => {
            for (let attempts = 0; attempts < FUN_THROWS_PER_WINDOW; attempts += 1) {
                await throwAt(ana, anaSession.participantId);
            }

            expect(await throwAt(ana, biaSession.participantId)).toEqual({ ok: true, data: null });
        });

        it('keeps the limit when the same participant reconnects on another socket', async () => {
            for (let throws = 0; throws < FUN_THROWS_PER_WINDOW; throws += 1) await throwAt(ana, biaSession.participantId);
            const reconnected = await connect();
            await dataOf(reconnected, 'room:join', {
                roomCode: anaSession.roomCode,
                name: 'Ana',
                sessionToken: anaSession.sessionToken,
            });

            expect(await throwAt(reconnected, biaSession.participantId)).toMatchObject({
                ok: false,
                error: { code: 'rate_limited' },
            });
        });

        it('never reaches another room', async () => {
            const carla = await connect();
            await dataOf<RoomSession>(carla, 'room:create', { roomName: 'Outra', participantName: 'Carla' });

            await throwAt(ana, biaSession.participantId);
            await bia.waitFor('fun:thrown');
            await wait(QUIET_PERIOD_MS);

            expect(carla.queued('fun:thrown')).toEqual([]);
        });
    });

    describe('fun:react', () => {
        it('emits fun:reacted to the whole table without touching room:state', async () => {
            const response = await ack(bia, 'fun:react', { reaction: '🤔' });
            const [toAna, toBia] = (await Promise.all([ana.waitFor('fun:reacted'), bia.waitFor('fun:reacted')])) as FunReacted[];

            expect(response).toEqual({ ok: true, data: null });
            expect(toBia).toEqual(toAna);
            expect(toAna).toMatchObject({ fromId: biaSession.participantId, reaction: '🤔' });
            expect(toAna.id.length).toBeGreaterThan(0);
            expect(toAna.reactedAt).toBeGreaterThan(0);
            await wait(QUIET_PERIOD_MS);
            expect(ana.queued('room:state')).toEqual([]);
            expect(bia.queued('room:state')).toEqual([]);
        });

        it('lets a spectator react', async () => {
            const spectator = await connect();
            const seat = await dataOf<RoomSession>(spectator, 'room:join', {
                roomCode: anaSession.roomCode,
                name: 'Duda',
                role: 'spectator',
            });

            expect(await ack(spectator, 'fun:react', { reaction: '☕' })).toEqual({ ok: true, data: null });
            expect(await ana.waitFor('fun:reacted')).toMatchObject({ fromId: seat.participantId, reaction: '☕' });
        });

        it('refuses a reaction outside the closed list', async () => {
            expect(await ack(ana, 'fun:react', { reaction: '💩' })).toMatchObject({
                ok: false,
                error: { code: 'invalid_payload' },
            });
        });

        it('refuses a socket without a seat with forbidden not_in_room', async () => {
            const visitor = await connect();

            expect(await ack(visitor, 'fun:react', { reaction: '👍' })).toMatchObject({
                ok: false,
                error: { code: 'forbidden', reason: 'not_in_room' },
            });
        });

        it('allows 5 reactions per 10 s and answers the 6th with rate_limited and retryAfterMs', async () => {
            for (let reactions = 0; reactions < FUN_REACTIONS_PER_WINDOW; reactions += 1) {
                expect(await ack(ana, 'fun:react', { reaction: '👍' })).toEqual({ ok: true, data: null });
            }

            const limited = (await ack(ana, 'fun:react', { reaction: '👍' })) as {
                ok: false;
                error: { code: string; retryAfterMs: number };
            };

            expect(limited.error.code).toBe('rate_limited');
            expect(limited.error.retryAfterMs).toBeGreaterThan(0);
            expect(limited.error.retryAfterMs).toBeLessThanOrEqual(FUN_REACTION_WINDOW_MS);
        });

        it('keeps reactions and throws on separate limits', async () => {
            for (let reactions = 0; reactions < FUN_REACTIONS_PER_WINDOW; reactions += 1) {
                await ack(ana, 'fun:react', { reaction: '👍' });
            }

            expect(await throwAt(ana, biaSession.participantId)).toEqual({ ok: true, data: null });
        });
    });
});
