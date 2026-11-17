import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
    Ack,
    KIRO_INVITE_TTL_MS,
    KiroInvite,
    kiroInviteSchema,
    MCP_PATH,
    MCP_PRODUCTION_URL,
    PROTOCOL_VERSION,
    RoomSession,
} from '../../../contracts';
import { RoomService } from '../../../domain/room.service';
import { GatewayModule } from '../../gateway.module';
import { SocketIoTestClient, socketIoUrl } from '../../testing/socket-io-test-client';
import { roomArea } from '../room';
import { kiroArea } from './index';
import { KIRO_MCP_URL } from './mcp-url';
const LONGEST_WAIT_MS = 5_000;
const ALLOW_KIRO = { allowKiro: true };
@Module({ imports: [GatewayModule.forAreas([roomArea, kiroArea])] })
class KiroGatewayTestModule {}
describe('kiro:invite over a real Socket.IO connection', () => {
    let app: INestApplication;
    const clients: SocketIoTestClient[] = [];
    beforeEach(async () => {
        delete process.env.PUBLIC_BASE_URL;
        app = await NestFactory.create(KiroGatewayTestModule, { logger: false });
        await app.listen(0);
    });
    afterEach(async () => {
        await Promise.allSettled(clients.splice(0).map((client) => client.close()));
        await app.close();
        delete process.env.PUBLIC_BASE_URL;
    });
    const connect = async () => {
        const client = await SocketIoTestClient.connect(socketIoUrl(app), {
            auth: { protocolVersion: PROTOCOL_VERSION },
            timeoutMs: LONGEST_WAIT_MS,
        });
        clients.push(client);
        return client;
    };
    const ack = async (client: SocketIoTestClient, event: string, payload: unknown = {}) =>
        (await client.emitWithAck(event, payload)) as Ack<unknown>;
    const seat = async (client: SocketIoTestClient, payload: Record<string, unknown>) => {
        const result = await ack(client, 'room:create', { roomName: 'Sprint', participantName: 'Ana', ...payload });
        if (!result.ok) throw new Error('room:create failed');
        return result.data as RoomSession;
    };
    const join = async (client: SocketIoTestClient, roomCode: string, name: string) => {
        const result = await ack(client, 'room:join', { roomCode, name });
        if (!result.ok) throw new Error('room:join failed');
    };
    it('issues an invite to a seated human with the production mcp url', async () => {
        const ana = await connect();
        await seat(ana, { settings: ALLOW_KIRO });
        const before = Date.now();
        const result = await ack(ana, 'kiro:invite');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const invite = kiroInviteSchema.parse(result.data) as KiroInvite;
        expect(invite.mcpUrl).toBe(MCP_PRODUCTION_URL);
        expect(invite.expiresAt).toBeGreaterThanOrEqual(before + KIRO_INVITE_TTL_MS);
        expect(invite.expiresAt).toBeLessThanOrEqual(Date.now() + KIRO_INVITE_TTL_MS);
    });
    it('uses PUBLIC_BASE_URL for the mcp url when configured', async () => {
        await app.close();
        process.env.PUBLIC_BASE_URL = 'http://localhost:3001/';
        app = await NestFactory.create(KiroGatewayTestModule, { logger: false });
        await app.listen(0);
        const ana = await connect();
        await seat(ana, { settings: ALLOW_KIRO });
        const result = await ack(ana, 'kiro:invite');
        expect(result).toMatchObject({ ok: true, data: { mcpUrl: `http://localhost:3001${MCP_PATH}` } });
        expect(app.get(KIRO_MCP_URL)).toBe(`http://localhost:3001${MCP_PATH}`);
    });
    it('answers kiro_disabled when the room does not allow Kiro', async () => {
        const ana = await connect();
        await seat(ana, {});
        expect(await ack(ana, 'kiro:invite')).toEqual({ ok: false, error: { code: 'kiro_disabled' } });
    });
    it('answers forbidden for a socket without a seat', async () => {
        const stranger = await connect();
        expect(await ack(stranger, 'kiro:invite')).toEqual({
            ok: false,
            error: { code: 'forbidden', reason: 'not_in_room' },
        });
    });
    it('rejects a payload that tries to name another participant', async () => {
        const ana = await connect();
        await seat(ana, { settings: ALLOW_KIRO });
        const result = await ack(ana, 'kiro:invite', { participantId: 'p-someone' });
        expect(result).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
    });
    it('keeps only the last invite of the same owner usable', async () => {
        const ana = await connect();
        const { roomCode } = await seat(ana, { settings: ALLOW_KIRO });
        const first = (await ack(ana, 'kiro:invite')) as Ack<KiroInvite>;
        const second = (await ack(ana, 'kiro:invite')) as Ack<KiroInvite>;
        if (!first.ok || !second.ok) throw new Error('invite failed');
        const rooms = app.get(RoomService);
        expect(() => rooms.redeemKiroInvite(first.data.inviteCode)).toThrow();
        expect(rooms.redeemKiroInvite(second.data.inviteCode).roomCode).toBe(roomCode);
    });
    it('answers kiro_limit_per_owner when the owner already has a Kiro', async () => {
        const ana = await connect();
        await seat(ana, { settings: ALLOW_KIRO });
        const invite = (await ack(ana, 'kiro:invite')) as Ack<KiroInvite>;
        if (!invite.ok) throw new Error('invite failed');
        app.get(RoomService).redeemKiroInvite(invite.data.inviteCode);
        expect(await ack(ana, 'kiro:invite')).toEqual({ ok: false, error: { code: 'kiro_limit_per_owner', limit: 1 } });
    });
    it('answers kiro_limit_per_room after three Kiros in the room', async () => {
        const owners = await Promise.all([connect(), connect(), connect(), connect()]);
        const { roomCode } = await seat(owners[0], { settings: ALLOW_KIRO });
        await Promise.all(owners.slice(1).map((client, index) => join(client, roomCode, `Pessoa ${index}`)));
        const rooms = app.get(RoomService);
        for (const owner of owners.slice(0, 3)) {
            const invite = (await ack(owner, 'kiro:invite')) as Ack<KiroInvite>;
            if (!invite.ok) throw new Error('invite failed');
            rooms.redeemKiroInvite(invite.data.inviteCode);
        }
        expect(await ack(owners[3], 'kiro:invite')).toEqual({ ok: false, error: { code: 'kiro_limit_per_room', limit: 3 } });
    });
});
