import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Ack, PROTOCOL_VERSION, RoomCreatePayload, RoomSession, RoomState } from '../../../contracts';
import { GatewayModule } from '../../gateway.module';
import { roomArea } from '../../handlers/room';
import { roundArea } from '../../handlers/round';
import { SocketIoTestClient, socketIoUrl } from '../../testing/socket-io-test-client';

@Module({ imports: [GatewayModule.forAreas([roomArea, roundArea])] })
class RoomGatewayTestModule {}

export const settle = (milliseconds = 100) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class GatewayTestApp {
    private readonly clients: SocketIoTestClient[] = [];

    private constructor(readonly app: INestApplication) {}

    static async start(): Promise<GatewayTestApp> {
        const app = await NestFactory.create(RoomGatewayTestModule, { logger: false });
        await app.listen(0);
        return new GatewayTestApp(app);
    }

    async connect(auth: Record<string, unknown> = { protocolVersion: PROTOCOL_VERSION }): Promise<SocketIoTestClient> {
        const client = await SocketIoTestClient.connect(socketIoUrl(this.app), { auth });
        this.clients.push(client);
        return client;
    }

    async close(): Promise<void> {
        await Promise.allSettled(this.clients.map((client) => client.close()));
        await this.app.close();
    }
}

export const ackOf = async (client: SocketIoTestClient, event: string, payload?: unknown): Promise<Ack<unknown>> =>
    (await client.emitWithAck(event, payload)) as Ack<unknown>;

export const dataOf = async <T>(client: SocketIoTestClient, event: string, payload?: unknown): Promise<T> => {
    const ack = await ackOf(client, event, payload);
    if (!ack.ok) throw new Error(`Expected ${event} to succeed but got ${ack.error.code}`);
    return ack.data as T;
};

export const createRoom = (
    client: SocketIoTestClient,
    overrides: Partial<Record<keyof RoomCreatePayload, unknown>> = {},
): Promise<RoomSession> =>
    dataOf<RoomSession>(client, 'room:create', { roomName: 'Sprint', participantName: 'Ana', ...overrides });

export const joinRoom = (
    client: SocketIoTestClient,
    roomCode: string,
    name: string,
    extra: Record<string, unknown> = {},
): Promise<RoomSession> => dataOf<RoomSession>(client, 'room:join', { roomCode, name, ...extra });

export const stateWhere = async (
    client: SocketIoTestClient,
    predicate: (state: RoomState) => boolean = () => true,
): Promise<RoomState> => {
    for (;;) {
        const state = (await client.waitFor('room:state')) as RoomState;
        if (predicate(state)) return state;
    }
};
