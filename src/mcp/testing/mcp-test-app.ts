import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AddressInfo } from 'node:net';
import { Ack, MCP_PATH, PROTOCOL_VERSION, RoomSession } from '../../contracts';
import { Clock } from '../../domain/clock';
import { DomainModule } from '../../domain/domain.module';
import { RoomService } from '../../domain/room.service';
import { FakeClock } from '../../domain/testing/fake-clock';
import { GatewayModule } from '../../gateway/gateway.module';
import { kiroArea } from '../../gateway/handlers/kiro';
import { roomArea } from '../../gateway/handlers/room';
import { roundArea } from '../../gateway/handlers/round';
import { Scheduler } from '../../gateway/session/scheduler';
import { FakeScheduler } from '../../gateway/session/testing/fake-scheduler';
import { SocketIoTestClient, socketIoUrl } from '../../gateway/testing/socket-io-test-client';
import { McpSessionHub } from '../mcp-session-hub';
import { McpController } from '../mcp.controller';
import { MCP_PROVIDERS } from '../mcp.module';
const LONGEST_WAIT_MS = 5_000;
export interface ToolResult {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content?: { type: string; text?: string }[];
}
export class McpTestApp {
    private readonly sockets: SocketIoTestClient[] = [];
    private readonly mcpClients: Client[] = [];
    private constructor(
        readonly app: INestApplication,
        readonly clock: FakeClock,
        readonly scheduler: FakeScheduler,
    ) {}
    static async start(): Promise<McpTestApp> {
        const clock = new FakeClock();
        const scheduler = new FakeScheduler(clock);
        @Module({
            imports: [DomainModule, GatewayModule.forAreas([roomArea, roundArea, kiroArea])],
            controllers: [McpController],
            providers: [
                { provide: Clock, useValue: clock },
                { provide: Scheduler, useValue: scheduler },
                ...MCP_PROVIDERS,
            ],
        })
        class McpTestModule {}
        const app = await NestFactory.create(McpTestModule, { logger: ['error'] });
        await app.listen(0);
        return new McpTestApp(app, clock, scheduler);
    }
    get port(): number {
        return (this.app.getHttpServer().address() as AddressInfo).port;
    }
    get mcpUrl(): string {
        return `http://127.0.0.1:${this.port}${MCP_PATH}`;
    }
    get rooms(): RoomService {
        return this.app.get(RoomService, { strict: false });
    }
    get hub(): McpSessionHub {
        return this.app.get(McpSessionHub, { strict: false });
    }
    async socket(): Promise<SocketIoTestClient> {
        const client = await SocketIoTestClient.connect(socketIoUrl(this.app), {
            auth: { protocolVersion: PROTOCOL_VERSION },
            timeoutMs: LONGEST_WAIT_MS,
        });
        this.sockets.push(client);
        return client;
    }
    async ackData<T>(client: SocketIoTestClient, event: string, payload: unknown = {}): Promise<T> {
        const ack = (await client.emitWithAck(event, payload)) as Ack<T>;
        if (!ack.ok) throw new Error(`${event} failed with ${ack.error.code}`);
        return ack.data;
    }
    async createRoomWithKiro(client: SocketIoTestClient, settings: Record<string, unknown> = {}): Promise<RoomSession> {
        return this.ackData<RoomSession>(client, 'room:create', {
            roomName: 'Sprint',
            participantName: 'Ana',
            settings: { allowKiro: true, countdownSeconds: 0, ...settings },
        });
    }
    async inviteOf(client: SocketIoTestClient): Promise<string> {
        return (await this.ackData<{ inviteCode: string }>(client, 'kiro:invite')).inviteCode;
    }
    async connectMcp(): Promise<Client> {
        const client = new Client({ name: 'kiro-test', version: '1.0.0' });
        await client.connect(new StreamableHTTPClientTransport(new URL(this.mcpUrl)));
        this.mcpClients.push(client);
        return client;
    }
    async close(): Promise<void> {
        await Promise.allSettled(
            this.mcpClients.map(async (client) => {
                await (client.transport as StreamableHTTPClientTransport | undefined)?.terminateSession();
                await client.close();
            }),
        );
        await Promise.allSettled(this.sockets.map((client) => client.close()));
        await this.app.close();
    }
}
export const callTool = async (client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> =>
    (await client.callTool({ name, arguments: args })) as ToolResult;
export const errorOf = (result: ToolResult): unknown =>
    result.isError ? JSON.parse(result.content?.[0]?.text ?? '{}') : undefined;
