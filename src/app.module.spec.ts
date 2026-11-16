import { INestApplication, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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

    describe('legacy events over a real Socket.IO connection', () => {
        it('answers login with start and the users of the room', async () => {
            const client = await connect();

            client.emit('login', { id: 'ana', room: 'A' });

            await expect(client.waitFor('start')).resolves.toEqual([{ id: 'ana', room: 'A' }]);
            await expect(client.waitFor('login')).resolves.toEqual({ id: 'ana', room: 'A' });
        });

        it('ignores a login sent with more than one argument, as before', async () => {
            const client = await connect();

            client.emit('login', { id: 'ana', room: 'A' }, 'extra');
            client.emit('login', { id: 'bia', room: 'A' });

            await expect(client.waitFor('start')).resolves.toEqual([{ id: 'bia', room: 'A' }]);
        });

        it('broadcasts logout to the room when a user disconnects', async () => {
            const ana = await connect();
            const bia = await connect();
            ana.emit('login', { id: 'ana', room: 'A' });
            await ana.waitFor('start');
            bia.emit('login', { id: 'bia', room: 'A' });
            await bia.waitFor('start');

            await ana.close();

            await expect(bia.waitFor('logout')).resolves.toEqual({ id: 'ana', room: 'A' });
        });
    });
});
