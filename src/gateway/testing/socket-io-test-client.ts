import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'net';

const ENGINE_IO_OPEN = '0';
const ENGINE_IO_PING = '2';
const ENGINE_IO_PONG = '3';
const ENGINE_IO_MESSAGE = '4';
const SOCKET_IO_CONNECT = '0';
const SOCKET_IO_DISCONNECT = '1';
const SOCKET_IO_EVENT = '2';
const SOCKET_IO_ACK = '3';
const SOCKET_IO_CONNECT_ERROR = '4';
const SOCKET_IO_PACKET = /^(\d)(\d*)(.*)$/s;
const DEFAULT_TIMEOUT_MS = 2_000;

export interface SocketIoTestClientOptions {
    auth?: Record<string, unknown>;
    timeoutMs?: number;
}

interface SocketIoPacket {
    type: string;
    ackId?: number;
    data: unknown;
}

type Waiter = (args: unknown[]) => void;

interface PendingAck {
    resolve: Waiter;
    reject: (error: Error) => void;
}

export class SocketIoConnectError extends Error {
    constructor(
        message: string,
        readonly data?: unknown,
    ) {
        super(message);
        this.name = SocketIoConnectError.name;
    }
}

export const socketIoUrl = (app: INestApplication): string => {
    const { port } = app.getHttpServer().address() as AddressInfo;
    return `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`;
};

const parseSocketIoPacket = (message: string): SocketIoPacket => {
    const [, type, ackId, json] = SOCKET_IO_PACKET.exec(message) ?? [];
    return {
        type,
        ackId: ackId ? Number(ackId) : undefined,
        data: json ? JSON.parse(json) : undefined,
    };
};

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, description: string): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms ${description}`)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

export class SocketIoTestClient {
    private readonly unconsumed = new Map<string, unknown[][]>();
    private readonly waiters = new Map<string, Waiter[]>();
    private readonly pendingAcks = new Map<number, PendingAck>();
    private readonly disconnections: (() => void)[] = [];
    private readonly closed: Promise<void>;
    private nextAckId = 0;
    private socketId: string | undefined;
    private connectedByServer = false;

    private constructor(
        private readonly webSocket: WebSocket,
        private readonly timeoutMs: number,
    ) {
        this.closed = new Promise((resolve) =>
            webSocket.addEventListener('close', () => {
                this.connectedByServer = false;
                this.rejectPendingAcks();
                this.notifyDisconnection();
                resolve();
            }),
        );
    }

    static connect(url: string, options: SocketIoTestClientOptions = {}): Promise<SocketIoTestClient> {
        const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const client = new SocketIoTestClient(new WebSocket(url), timeoutMs);
        return withTimeout(client.handshake(options.auth), timeoutMs, `connecting to ${url}`).then(
            () => client,
            async (error: unknown) => {
                await client.close();
                throw error;
            },
        );
    }

    get id(): string {
        if (!this.socketId) {
            throw new Error('Socket.IO test client is not connected');
        }
        return this.socketId;
    }

    get connected(): boolean {
        return this.connectedByServer && this.webSocket.readyState === WebSocket.OPEN;
    }

    get pendingAckCount(): number {
        return this.pendingAcks.size;
    }

    waitForDisconnect(): Promise<void> {
        if (!this.connected) {
            return Promise.resolve();
        }
        return withTimeout(
            new Promise<void>((resolve) => this.disconnections.push(resolve)),
            this.timeoutMs,
            'waiting for the disconnection',
        );
    }

    emit(event: string, ...args: unknown[]): void {
        this.send(SOCKET_IO_EVENT, '', [event, ...args]);
    }

    emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
        const ackId = this.nextAckId++;
        const acknowledged = new Promise<unknown[]>((resolve, reject) =>
            this.pendingAcks.set(ackId, { resolve, reject }),
        );
        this.send(SOCKET_IO_EVENT, String(ackId), [event, ...args]);
        return withTimeout(acknowledged, this.timeoutMs, `waiting for the ack of "${event}"`)
            .then(([response]) => response)
            .finally(() => this.pendingAcks.delete(ackId));
    }

    async waitFor(event: string): Promise<unknown> {
        const [payload] = await this.waitForArgs(event);
        return payload;
    }

    waitForArgs(event: string): Promise<unknown[]> {
        const queued = this.unconsumed.get(event)?.shift();
        if (queued) {
            return Promise.resolve(queued);
        }
        let waiter: Waiter | undefined;
        const received = new Promise<unknown[]>((resolve) => {
            waiter = resolve;
            this.waitersOf(event).push(resolve);
        });
        return withTimeout(received, this.timeoutMs, `waiting for "${event}"`).finally(() =>
            this.removeWaiter(event, waiter),
        );
    }

    queued(event: string): unknown[][] {
        return [...(this.unconsumed.get(event) ?? [])];
    }

    async close(): Promise<void> {
        if (this.webSocket.readyState !== WebSocket.CLOSED) {
            this.webSocket.close();
        }
        await this.closed;
    }

    private handshake(auth: Record<string, unknown> | undefined): Promise<void> {
        return new Promise((resolve, reject) => {
            this.webSocket.addEventListener('error', () => reject(new Error('WebSocket connection failed')));
            this.webSocket.addEventListener('close', () => reject(new Error('WebSocket closed before connecting')));
            this.webSocket.addEventListener('message', ({ data }) => {
                const message = String(data);
                if (message.startsWith(ENGINE_IO_OPEN)) {
                    this.send(SOCKET_IO_CONNECT, '', auth);
                    return;
                }
                if (message === ENGINE_IO_PING) {
                    this.webSocket.send(ENGINE_IO_PONG);
                    return;
                }
                if (message.startsWith(ENGINE_IO_MESSAGE)) {
                    this.handleSocketIoPacket(parseSocketIoPacket(message.slice(1)), resolve, reject);
                }
            });
        });
    }

    private handleSocketIoPacket(packet: SocketIoPacket, onConnect: () => void, onReject: (error: Error) => void) {
        switch (packet.type) {
            case SOCKET_IO_CONNECT:
                this.socketId = (packet.data as { sid: string }).sid;
                this.connectedByServer = true;
                onConnect();
                return;
            case SOCKET_IO_CONNECT_ERROR: {
                const { message, data } = packet.data as { message: string; data?: unknown };
                onReject(new SocketIoConnectError(message, data));
                return;
            }
            case SOCKET_IO_DISCONNECT:
                this.connectedByServer = false;
                this.notifyDisconnection();
                return;
            case SOCKET_IO_EVENT: {
                const [event, ...args] = packet.data as [string, ...unknown[]];
                this.deliver(event, args);
                return;
            }
            case SOCKET_IO_ACK:
                this.pendingAcks.get(packet.ackId ?? -1)?.resolve(packet.data as unknown[]);
                return;
        }
    }

    private rejectPendingAcks() {
        this.pendingAcks.forEach(({ reject }) => reject(new Error('Socket closed before the ack arrived')));
        this.pendingAcks.clear();
    }

    private notifyDisconnection() {
        this.disconnections.splice(0).forEach((resolve) => resolve());
    }

    private deliver(event: string, args: unknown[]) {
        const waiter = this.waiters.get(event)?.shift();
        if (waiter) {
            waiter(args);
            return;
        }
        this.unconsumed.set(event, [...(this.unconsumed.get(event) ?? []), args]);
    }

    private send(type: string, ackId: string, data: unknown) {
        const json = data === undefined ? '' : JSON.stringify(data);
        this.webSocket.send(`${ENGINE_IO_MESSAGE}${type}${ackId}${json}`);
    }

    private waitersOf(event: string): Waiter[] {
        const waiters = this.waiters.get(event) ?? [];
        this.waiters.set(event, waiters);
        return waiters;
    }

    private removeWaiter(event: string, waiter: Waiter | undefined) {
        const waiters = this.waiters.get(event) ?? [];
        this.waiters.set(
            event,
            waiters.filter((candidate) => candidate !== waiter),
        );
    }
}
