import { INestApplication, Injectable, LoggerService, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Server } from 'socket.io';
import { defineGatewayArea, GatewayArea } from './gateway-area';
import { GatewayContributor, GatewayRegistry } from './gateway-registry';
import { GatewayModule } from './gateway.module';
import { HandshakeRejectedError } from './handshake-rejected.error';
import { SocketIoConnectError, SocketIoTestClient, socketIoUrl } from './testing/socket-io-test-client';

const SECRET = 'secret-value';
const PASS = { pass: 'yak' };

interface GreetRequest {
    name: string;
    room: string;
}

@Injectable()
class GreetingService {
    greet(name: string): string {
        return `hello ${name}`;
    }
}

@Module({ providers: [GreetingService], exports: [GreetingService] })
class GreetingModule {}

class MemoryLogger implements LoggerService {
    readonly lines: string[] = [];
    log = (...messages: unknown[]) => this.record(messages);
    error = (...messages: unknown[]) => this.record(messages);
    warn = (...messages: unknown[]) => this.record(messages);
    debug = (...messages: unknown[]) => this.record(messages);
    verbose = (...messages: unknown[]) => this.record(messages);
    fatal = (...messages: unknown[]) => this.record(messages);

    errors(): string {
        return this.lines.filter((line) => line.includes('failed')).join('\n');
    }

    private record(messages: unknown[]) {
        this.lines.push(messages.map((message) => String(message)).join(' '));
    }
}

class TestProbe {
    readonly connectedIds: string[] = [];
    readonly initializedServers: Server[] = [];
    failServerInit = false;
    private readonly disconnections: ((socketId: string) => void)[] = [];
    private markDisconnectHookRan: () => void = () => undefined;
    readonly disconnectHookRan = new Promise<void>((resolve) => (this.markDisconnectHookRan = resolve));

    nextDisconnection(): Promise<string> {
        return new Promise((resolve) => this.disconnections.push(resolve));
    }

    disconnected(socketId: string) {
        this.disconnections.shift()?.(socketId);
        this.markDisconnectHookRan();
    }
}

@Injectable()
class TestHandlers implements GatewayContributor {
    constructor(
        private readonly greetings: GreetingService,
        private readonly probe: TestProbe,
    ) {}

    register(registry: GatewayRegistry): void {
        registry.useHandshake((socket) => {
            if (socket.handshake.auth.crash) {
                throw new Error(SECRET);
            }
        });
        registry.useHandshake(async (socket) => {
            if (socket.handshake.auth.rejectAsync) {
                throw new Error(SECRET);
            }
        });
        registry.useHandshake((socket) => {
            if (socket.handshake.auth.pass !== PASS.pass) {
                throw new HandshakeRejectedError('test:pass_required', { field: 'pass' });
            }
        });
        registry.onServerInit(async (server) => {
            this.probe.initializedServers.push(server);
            if (this.probe.failServerInit) {
                throw new Error(SECRET);
            }
        });
        registry.onConnection(async ({ socket }) => {
            if (socket.handshake.auth.failConnectionHook) {
                throw new Error(SECRET);
            }
            if (socket.handshake.auth.rejectConnectionHook) {
                await Promise.reject(new Error(SECRET));
            }
            this.probe.connectedIds.push(socket.id);
        });
        registry.onDisconnect(async ({ socket }) => {
            this.probe.disconnected(socket.id);
            if (socket.handshake.auth.rejectDisconnectHook) {
                throw new Error(SECRET);
            }
        });
        registry.on('test:hang', () => new Promise(() => undefined));
        registry.on('test:join', async (room, { socket }) => {
            await socket.join(String(room));
            return 'joined';
        });
        registry.on('test:greet', (payload, { server }) => {
            const { name, room } = payload as GreetRequest;
            const greeting = this.greetings.greet(name);
            server.to(room).emit('test:greeted', greeting);
            return greeting;
        });
        registry.on('test:whisper', (payload, { socket }) => {
            socket.emit('test:whispered', payload);
            return 'whispered';
        });
        registry.on('test:shout', (payload, { server }) => {
            server.emit('test:shouted', payload);
            return 'shouted';
        });
        registry.on('test:fail', (payload) => {
            throw new Error(`cannot handle ${String(payload)}`);
        });
        registry.on('test:fail-async', async (payload) => {
            throw new Error(`cannot handle ${String(payload)}`);
        });
    }
}

const testArea = (probe: TestProbe): GatewayArea =>
    defineGatewayArea({
        name: 'test',
        imports: [GreetingModule],
        providers: [{ provide: TestProbe, useValue: probe }],
        contributors: [TestHandlers],
    });

describe('GatewayModule with a test area', () => {
    let app: INestApplication;
    let probe: TestProbe;
    let logger: MemoryLogger;
    let clients: SocketIoTestClient[];

    const connect = async (auth: Record<string, unknown> = PASS) => {
        const client = await SocketIoTestClient.connect(socketIoUrl(app), { auth });
        clients.push(client);
        return client;
    };

    beforeEach(async () => {
        probe = new TestProbe();
        logger = new MemoryLogger();
        clients = [];
        @Module({ imports: [GatewayModule.forAreas([testArea(probe)])] })
        class TestAppModule {}
        app = await NestFactory.create(TestAppModule, { logger });
        await app.listen(0);
    });

    afterEach(async () => {
        await Promise.allSettled(clients.map((client) => client.close()));
        await app.close();
    });

    describe('handlers', () => {
        it('receives the payload, answers through the ack and emits to a room', async () => {
            const inRoom = await connect();
            const outOfRoom = await connect();
            await inRoom.emitWithAck('test:join', 'R');

            const ack = await outOfRoom.emitWithAck('test:greet', { name: 'ana', room: 'R' });

            expect(ack).toBe('hello ana');
            await expect(inRoom.waitFor('test:greeted')).resolves.toBe('hello ana');
            expect(outOfRoom.queued('test:greeted')).toEqual([]);
        });

        it('uses a service injected from another module', async () => {
            const client = await connect();

            await expect(client.emitWithAck('test:greet', { name: 'bia', room: 'R' })).resolves.toBe(
                app.get(GreetingService).greet('bia'),
            );
        });

        it('emits only to the socket that sent the event', async () => {
            const sender = await connect();
            const other = await connect();

            await sender.emitWithAck('test:whisper', 'psst');
            await other.emitWithAck('test:join', 'R');

            await expect(sender.waitFor('test:whispered')).resolves.toBe('psst');
            expect(other.queued('test:whispered')).toEqual([]);
        });

        it('emits to every connected socket', async () => {
            const sender = await connect();
            const other = await connect();

            await sender.emitWithAck('test:shout', 'hey');

            await expect(sender.waitFor('test:shouted')).resolves.toBe('hey');
            await expect(other.waitFor('test:shouted')).resolves.toBe('hey');
        });

        it('ignores an event without handler and keeps serving the next one', async () => {
            const client = await connect();

            client.emit('test:unknown', SECRET);

            await expect(client.emitWithAck('test:join', 'R')).resolves.toBe('joined');
            expect(client.connected).toBe(true);
        });

        it.each(['test:fail', 'test:fail-async'])(
            'logs the failure of %s without the payload and keeps serving the next event',
            async (event) => {
                const client = await connect();

                client.emit(event, SECRET);

                await expect(client.emitWithAck('test:join', 'R')).resolves.toBe('joined');
                expect(logger.errors()).toContain(`Handler of event "${event}" failed for client ${client.id}`);
                expect(logger.lines.join('\n')).not.toContain(SECRET);
            },
        );
    });

    describe('failing handler with ack', () => {
        it.each(['test:fail', 'test:fail-async'])(
            'answers the ack of %s with internal_error and logs without the payload',
            async (event) => {
                const client = await connect();

                const ack = await client.emitWithAck(event, SECRET);

                expect(ack).toEqual({ ok: false, error: { code: 'internal_error' } });
                expect(logger.errors()).not.toBe('');
                expect(logger.lines.join('\n')).not.toContain(SECRET);
                await expect(client.emitWithAck('test:join', 'R')).resolves.toBe('joined');
            },
        );

        it('sends no response and no event when the failing handler had no ack', async () => {
            const client = await connect();

            client.emit('test:fail', SECRET);

            await expect(client.emitWithAck('test:join', 'R')).resolves.toBe('joined');
            expect(client.queued('test:fail')).toEqual([]);
            expect(client.pendingAckCount).toBe(0);
        });
    });

    describe('handshake middlewares', () => {
        it('rejects the connection when handshake.auth has no pass', async () => {
            const rejection = connect({});

            await expect(rejection).rejects.toBeInstanceOf(SocketIoConnectError);
            await expect(rejection).rejects.toMatchObject({
                message: 'test:pass_required',
                data: { field: 'pass' },
            });
        });

        it('accepts the connection when handshake.auth has the pass', async () => {
            const client = await connect(PASS);

            expect(client.connected).toBe(true);
        });

        it('hides an unexpected middleware error from the client and from the log', async () => {
            const rejection = connect({ ...PASS, crash: true });

            await expect(rejection).rejects.toMatchObject({ message: 'Connection rejected' });
            expect(logger.errors()).toContain('Handshake middleware failed');
            expect(logger.errors()).not.toBe('');
            expect(logger.lines.join('\n')).not.toContain(SECRET);
        });

        it('hides an asynchronously rejecting middleware error and keeps accepting connections', async () => {
            const rejection = connect({ ...PASS, rejectAsync: true });

            await expect(rejection).rejects.toMatchObject({ message: 'Connection rejected' });
            expect(logger.errors()).toContain('Handshake middleware failed');
            expect(logger.lines.join('\n')).not.toContain(SECRET);
            const client = await connect();
            await expect(client.emitWithAck('test:join', 'R')).resolves.toBe('joined');
        });
    });

    describe('lifecycle hooks', () => {
        it('calls the server init hook once with the Socket.IO server', () => {
            expect(probe.initializedServers).toHaveLength(1);
            expect(probe.initializedServers[0]).toBeInstanceOf(Server);
        });

        it('calls the connection hook with the socket that connected', async () => {
            const client = await connect();
            await client.emitWithAck('test:join', 'R');

            expect(probe.connectedIds).toEqual([client.id]);
        });

        it('calls the disconnect hook with the socket that dropped', async () => {
            const client = await connect();
            const disconnection = probe.nextDisconnection();

            await client.close();

            await expect(disconnection).resolves.toBe(client.id);
        });

        it('logs a failing connection hook without stopping the socket', async () => {
            const client = await connect({ ...PASS, failConnectionHook: true });

            await expect(client.emitWithAck('test:join', 'R')).resolves.toBe('joined');
            expect(logger.errors()).toContain(`Connection hook failed for client ${client.id}`);
            expect(logger.errors()).not.toBe('');
            expect(logger.lines.join('\n')).not.toContain(SECRET);
        });

        it('logs a rejecting async connection hook without stopping the socket', async () => {
            const client = await connect({ ...PASS, rejectConnectionHook: true });

            await expect(client.emitWithAck('test:join', 'R')).resolves.toBe('joined');
            expect(logger.errors()).toContain(`Connection hook failed for client ${client.id}`);
            expect(logger.lines.join('\n')).not.toContain(SECRET);
        });

        it('logs a rejecting disconnect hook and keeps serving other clients', async () => {
            const dropped = await connect({ ...PASS, rejectDisconnectHook: true });
            const other = await connect();

            await dropped.close();
            await probe.disconnectHookRan;

            await expect(other.emitWithAck('test:join', 'R')).resolves.toBe('joined');
            expect(logger.errors()).toContain(`Disconnect hook failed for client ${dropped.id}`);
            expect(logger.lines.join('\n')).not.toContain(SECRET);
        });

        it('knows when the server dropped the socket', async () => {
            const client = await connect();

            probe.initializedServers[0].disconnectSockets();

            await client.waitForDisconnect();
            expect(client.connected).toBe(false);
        });

        it('rejects a pending ack when the socket closes', async () => {
            const client = await connect();
            const pending = client.emitWithAck('test:hang');

            await client.close();

            await expect(pending).rejects.toThrow('closed');
        });
    });

    describe('failing server init hook', () => {
        it('logs the failure without the payload and keeps serving events', async () => {
            const failingLogger = new MemoryLogger();
            const failingProbe = new TestProbe();
            failingProbe.failServerInit = true;
            @Module({ imports: [GatewayModule.forAreas([testArea(failingProbe)])] })
            class FailingInitModule {}
            const failingApp = await NestFactory.create(FailingInitModule, { logger: failingLogger });
            await failingApp.listen(0);
            const client = await SocketIoTestClient.connect(socketIoUrl(failingApp), { auth: PASS });

            try {
                await expect(client.emitWithAck('test:join', 'R')).resolves.toBe('joined');
                expect(failingLogger.errors()).toContain('Server init hook failed');
                expect(failingLogger.lines.join('\n')).not.toContain(SECRET);
            } finally {
                await client.close();
                await failingApp.close();
            }
        });
    });
});

describe('GatewayModule.forAreas', () => {
    it('rejects two areas with the same name', () => {
        const areas = [defineGatewayArea({ name: 'room' }), defineGatewayArea({ name: 'room' })];

        expect(() => GatewayModule.forAreas(areas)).toThrow('Gateway area "room" is defined twice');
    });
});
