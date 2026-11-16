import { INestApplication, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AddressInfo } from 'net';
import { AppModule } from './app.module';
import { DomainModule } from './domain/domain.module';
import { SocketIoTestClient, socketIoUrl } from './gateway/testing/socket-io-test-client';
import { JiraAuthModule } from './jira/auth/jira-auth.module';
import { JiraHttpModule } from './jira/http/jira-http.module';
import { JiraRoomModule } from './jira/room/jira-room.module';
import { McpModule } from './mcp/mcp.module';

describe('AppModule', () => {
    let app: INestApplication;
    let clients: SocketIoTestClient[];

    const connect = async () => {
        const client = await SocketIoTestClient.connect(socketIoUrl(app));
        clients.push(client);
        return client;
    };

    beforeEach(async () => {
        clients = [];
        app = await NestFactory.create(AppModule, { logger: false });
        await app.listen(0);
    });

    afterEach(async () => {
        await Promise.all(clients.map((client) => client.close()));
        await app.close();
    });

    it.each<[string, Type<unknown>]>([
        ['DomainModule', DomainModule],
        ['JiraAuthModule', JiraAuthModule],
        ['JiraHttpModule', JiraHttpModule],
        ['JiraRoomModule', JiraRoomModule],
        ['McpModule', McpModule],
    ])('boots with the %s wired in', (_, module) => {
        expect(() => app.select(module)).not.toThrow();
    });

    it('answers GET /health', async () => {
        const { port } = app.getHttpServer().address() as AddressInfo;

        const response = await fetch(`http://127.0.0.1:${port}/health`);

        expect(response.status).toBe(200);
    });

    it('keeps serving after a real Socket.IO client emits an event without handler', async () => {
        const client = await connect();

        client.emit('event-without-handler', { any: 'payload' });
        const other = await connect();

        expect(client.connected).toBe(true);
        expect(other.connected).toBe(true);
    });
});
