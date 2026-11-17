import { PROTOCOL_VERSION, roomSessionSchema, roomStateSchema } from '../../../contracts';
import { MAX_CONNECTIONS_PER_ADDRESS, SOCKET_EVENT_LIMIT } from '../../session/limits';
import {
    ackOf,
    createRoom,
    GatewayTestApp,
    joinRoom,
    settle,
    stateWhere,
} from '../../session/testing/gateway-test-app';
import { SocketIoConnectError } from '../../testing/socket-io-test-client';

const SECRET = 'valor-secreto-do-cliente';

describe('room events over a real Socket.IO connection', () => {
    let gateway: GatewayTestApp;

    beforeEach(async () => {
        gateway = await GatewayTestApp.start();
    });

    afterEach(() => gateway.close());

    describe('handshake', () => {
        const unsupported = {
            message: 'protocol_version_unsupported',
            data: { code: 'protocol_version_unsupported', serverProtocolVersion: PROTOCOL_VERSION },
        };

        it.each([
            ['no auth', {}],
            ['an invalid version', { protocolVersion: 'abc' }],
            ['a version that is not a string', { protocolVersion: 1 }],
            ['an unsupported major version', { protocolVersion: '2.0' }],
            ['a newer minor version', { protocolVersion: '1.5' }],
            ['an extra auth field', { protocolVersion: PROTOCOL_VERSION, extra: true }],
        ])('rejects a client with %s', async (_, auth) => {
            const rejection = await gateway.connect(auth).catch((error: unknown) => error);
            expect(rejection).toBeInstanceOf(SocketIoConnectError);
            expect(rejection).toMatchObject(unsupported);
        });

        it('accepts the supported version', async () => {
            await expect(gateway.connect({ protocolVersion: PROTOCOL_VERSION })).resolves.toBeDefined();
        });

        it('rejects the connection after the maximum of sockets of one address', async () => {
            await Promise.all(Array.from({ length: MAX_CONNECTIONS_PER_ADDRESS }, () => gateway.connect()));
            const rejection = await gateway.connect().catch((error: unknown) => error);
            expect(rejection).toMatchObject({ message: 'rate_limited', data: { code: 'rate_limited' } });
            expect((rejection as SocketIoConnectError).data).toEqual(
                expect.objectContaining({ retryAfterMs: expect.any(Number) }),
            );
        });
    });

    describe('room:create and room:join', () => {
        it('creates a room, answers with the session and sends the state to the creator', async () => {
            const ana = await gateway.connect();
            const session = await createRoom(ana);
            expect(roomSessionSchema.safeParse(session).success).toBe(true);
            const state = await stateWhere(ana);
            expect(roomStateSchema.safeParse(state).success).toBe(true);
            expect(state.self.participantId).toBe(session.participantId);
            expect(state.room.name).toBe('Sprint');
            expect(state.jira).toBeNull();
        });

        it('lets a second socket join and sends each one its own state', async () => {
            const ana = await gateway.connect();
            const bia = await gateway.connect();
            const anaSession = await createRoom(ana);
            const biaSession = await joinRoom(bia, anaSession.roomCode, 'Bia');
            const stateOfBia = await stateWhere(bia);
            const stateOfAna = await stateWhere(ana, (state) => state.participants.length === 2);
            expect(stateOfBia.self.participantId).toBe(biaSession.participantId);
            expect(stateOfAna.self.participantId).toBe(anaSession.participantId);
        });

        it('answers room_not_found with the server instance for an unknown room', async () => {
            const ana = await gateway.connect();
            const ack = await ackOf(ana, 'room:join', { roomCode: 'yak-zzzz9999', name: 'Ana' });
            expect(ack).toEqual({
                ok: false,
                error: { code: 'room_not_found', serverInstanceId: expect.any(String) },
            });
        });

        it('refuses a spectator when the room does not allow them', async () => {
            const ana = await gateway.connect();
            const bia = await gateway.connect();
            const { roomCode } = await createRoom(ana, { settings: { allowSpectators: false } });
            const ack = await ackOf(bia, 'room:join', { roomCode, name: 'Bia', role: 'spectator' });
            expect(ack).toEqual({ ok: false, error: { code: 'spectators_disabled' } });
        });

        it('does not send a room state to a socket that has no seat', async () => {
            const visitor = await gateway.connect();
            const ana = await gateway.connect();
            await createRoom(ana);
            await stateWhere(ana);
            await settle();
            expect(visitor.queued('room:state')).toEqual([]);
        });
    });

    describe('reconnection with the session token', () => {
        it('binds the new socket to the same participant and keeps the seat', async () => {
            const first = await gateway.connect();
            const session = await createRoom(first);
            await first.close();
            const second = await gateway.connect();
            const rejoined = await joinRoom(second, session.roomCode, 'Qualquer nome', {
                sessionToken: session.sessionToken,
            });
            expect(rejoined.participantId).toBe(session.participantId);
            const state = await stateWhere(second);
            expect(state.self.participantId).toBe(session.participantId);
            expect(state.participants).toHaveLength(1);
        });

        it('refuses a wrong token without seating the socket', async () => {
            const ana = await gateway.connect();
            const { roomCode } = await createRoom(ana);
            const intruder = await gateway.connect();
            const wrongToken = 'A'.repeat(43);
            const ack = await ackOf(intruder, 'room:join', { roomCode, name: 'Ana', sessionToken: wrongToken });
            expect(ack).toEqual({ ok: false, error: { code: 'session_token_invalid' } });
            expect(await ackOf(intruder, 'room:leave', {})).toEqual({
                ok: false,
                error: { code: 'forbidden', reason: 'not_in_room' },
            });
        });

        it('does not accept the token of one room to act in another room', async () => {
            const ana = await gateway.connect();
            const caio = await gateway.connect();
            const anaSession = await createRoom(ana);
            const caioSession = await createRoom(caio, { participantName: 'Caio' });
            const ack = await ackOf(caio, 'room:join', {
                roomCode: caioSession.roomCode,
                name: 'Ana',
                sessionToken: anaSession.sessionToken,
            });
            expect(ack).toEqual({ ok: false, error: { code: 'session_token_invalid' } });
        });
    });

    describe('identity', () => {
        it('refuses an event from a socket without seat', async () => {
            const visitor = await gateway.connect();
            const ack = await ackOf(visitor, 'round:vote', { roundId: 1, value: 'M' });
            expect(ack).toEqual({ ok: false, error: { code: 'forbidden', reason: 'not_in_room' } });
        });

        it('refuses a participantId sent in the payload of an event that takes none', async () => {
            const ana = await gateway.connect();
            const bia = await gateway.connect();
            const { roomCode, participantId } = await createRoom(ana);
            await joinRoom(bia, roomCode, 'Bia');
            const ack = await ackOf(bia, 'round:vote', { roundId: 1, value: 'M', participantId });
            expect(ack).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
        });

        it('keeps a socket seated in one room from acting in another room', async () => {
            const ana = await gateway.connect();
            const caio = await gateway.connect();
            await createRoom(ana);
            await createRoom(caio, { participantName: 'Caio' });
            await stateWhere(ana);
            await stateWhere(caio);
            expect(await ackOf(caio, 'room:updateSettings', { autoReveal: true })).toEqual({ ok: true, data: null });
            const stateOfCaio = await stateWhere(caio);
            await settle();
            expect(stateOfCaio.settings.autoReveal).toBe(true);
            expect(ana.queued('room:state')).toEqual([]);
        });
    });

    describe('room:leave, room:updateSettings, room:transferFacilitator and room:setRole', () => {
        it('removes the participant from the state of the others and unseats the socket', async () => {
            const ana = await gateway.connect();
            const bia = await gateway.connect();
            const { roomCode } = await createRoom(ana);
            await joinRoom(bia, roomCode, 'Bia');
            await stateWhere(ana, (state) => state.participants.length === 2);
            expect(await ackOf(bia, 'room:leave', {})).toEqual({ ok: true, data: null });
            const state = await stateWhere(ana, (candidate) => candidate.participants.length === 1);
            expect(state.participants.map(({ name }) => name)).toEqual(['Ana']);
            expect(await ackOf(bia, 'round:vote', { roundId: 1, value: 'M' })).toMatchObject({
                error: { code: 'forbidden', reason: 'not_in_room' },
            });
        });

        it('updates the settings for the facilitator and tells everyone', async () => {
            const ana = await gateway.connect();
            const bia = await gateway.connect();
            const { roomCode } = await createRoom(ana);
            await joinRoom(bia, roomCode, 'Bia');
            expect(await ackOf(ana, 'room:updateSettings', { autoReveal: true })).toEqual({ ok: true, data: null });
            const state = await stateWhere(bia, (candidate) => candidate.settings.autoReveal);
            expect(state.settings.autoReveal).toBe(true);
        });

        it('refuses the settings of a participant who is not the facilitator', async () => {
            const ana = await gateway.connect();
            const bia = await gateway.connect();
            const { roomCode } = await createRoom(ana);
            await joinRoom(bia, roomCode, 'Bia');
            expect(await ackOf(bia, 'room:updateSettings', { autoReveal: true })).toEqual({
                ok: false,
                error: { code: 'forbidden', reason: 'facilitator_only' },
            });
        });

        it('rejects an empty settings patch', async () => {
            const ana = await gateway.connect();
            await createRoom(ana);
            expect(await ackOf(ana, 'room:updateSettings', {})).toMatchObject({
                ok: false,
                error: { code: 'invalid_payload' },
            });
        });

        it('transfers the facilitator role to another human', async () => {
            const ana = await gateway.connect();
            const bia = await gateway.connect();
            const { roomCode } = await createRoom(ana);
            const biaSession = await joinRoom(bia, roomCode, 'Bia');
            expect(
                await ackOf(ana, 'room:transferFacilitator', { participantId: biaSession.participantId }),
            ).toEqual({ ok: true, data: null });
            const state = await stateWhere(bia, (candidate) =>
                candidate.participants.some(({ id, isFacilitator }) => id === biaSession.participantId && isFacilitator),
            );
            expect(state.participants.filter(({ isFacilitator }) => isFacilitator)).toHaveLength(1);
        });

        it('refuses a transfer asked by who is not the facilitator', async () => {
            const ana = await gateway.connect();
            const bia = await gateway.connect();
            const anaSession = await createRoom(ana);
            await joinRoom(bia, anaSession.roomCode, 'Bia');
            expect(
                await ackOf(bia, 'room:transferFacilitator', { participantId: anaSession.participantId }),
            ).toEqual({ ok: false, error: { code: 'forbidden', reason: 'facilitator_only' } });
        });

        it('lets the participant change its own role', async () => {
            const ana = await gateway.connect();
            const { participantId } = await createRoom(ana);
            expect(await ackOf(ana, 'room:setRole', { role: 'spectator' })).toEqual({ ok: true, data: null });
            const state = await stateWhere(ana, (candidate) => candidate.participants[0].role === 'spectator');
            expect(state.participants[0].id).toBe(participantId);
        });
    });

    describe('payload validation', () => {
        it('answers invalid_payload with fixed messages and never echoes what was sent', async () => {
            const ana = await gateway.connect();
            const ack = await ackOf(ana, 'room:create', {
                roomName: SECRET.repeat(5),
                participantName: 'Ana',
                [SECRET]: SECRET,
            });
            expect(ack).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
            expect(JSON.stringify(ack)).not.toContain(SECRET);
        });

        it('answers invalid_payload when no payload is sent', async () => {
            const ana = await gateway.connect();
            expect(await ackOf(ana, 'room:create')).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
        });
    });

    describe('limits', () => {
        it('answers rate_limited with retryAfterMs when a socket sends too many events', async () => {
            const visitor = await gateway.connect();
            const acks = await Promise.all(
                Array.from({ length: SOCKET_EVENT_LIMIT.limit + 1 }, () => ackOf(visitor, 'room:leave', {})),
            );
            const limited = acks.filter((ack) => !ack.ok && ack.error.code === 'rate_limited');
            expect(limited).toHaveLength(1);
            expect(limited[0]).toEqual({ ok: false, error: { code: 'rate_limited', retryAfterMs: expect.any(Number) } });
        });

        it('disconnects a socket that sends a message above 16 KB', async () => {
            const ana = await gateway.connect();
            ana.emit('room:create', { roomName: 'x'.repeat(20_000), participantName: 'Ana' });
            await expect(ana.waitForDisconnect()).resolves.toBeUndefined();
        });
    });

    describe('presence', () => {
        it('marks the participant as disconnected for the others when the socket drops', async () => {
            const ana = await gateway.connect();
            const bia = await gateway.connect();
            const { roomCode } = await createRoom(ana);
            const biaSession = await joinRoom(bia, roomCode, 'Bia');
            await stateWhere(ana, (state) => state.participants.length === 2);
            await bia.close();
            const state = await stateWhere(ana, (candidate) =>
                candidate.participants.some(({ id, presence }) => id === biaSession.participantId && presence === 'disconnected'),
            );
            expect(state.participants).toHaveLength(2);
        });

        it('keeps the participant connected while another socket of it is still open', async () => {
            const first = await gateway.connect();
            const observer = await gateway.connect();
            const session = await createRoom(first);
            await joinRoom(observer, session.roomCode, 'Bia');
            const second = await gateway.connect();
            await joinRoom(second, session.roomCode, 'Ana', { sessionToken: session.sessionToken });
            await first.close();
            await settle();
            const state = await stateWhere(observer);
            expect(state.participants.find(({ id }) => id === session.participantId)?.presence).toBe('connected');
        });
    });
});
