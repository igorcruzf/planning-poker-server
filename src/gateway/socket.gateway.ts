import { Logger, WsMessageHandler } from '@nestjs/common';
import { ApplicationConfig } from '@nestjs/core';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { from } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { describeError } from './describe-error';
import { GatewayConnectionHook, GatewayContext, GatewayEventHandler, GatewayHandshakeMiddleware } from './gateway-registry';
import { GatewayRegistrations } from './gateway-registrations';
import { gatewayOptions } from './gateway.options';
import { HandshakeRejectedError } from './handshake-rejected.error';

const GENERIC_HANDSHAKE_REJECTION = 'Connection rejected';

type SocketIoMiddleware = (socket: Socket, next: (error?: Error) => void) => void;

const runSafely = (action: () => unknown): Promise<unknown> => {
    try {
        return Promise.resolve(action());
    } catch (error) {
        return Promise.reject(error);
    }
};

@WebSocketGateway(gatewayOptions())
export class SocketGateway implements OnGatewayInit<Server>, OnGatewayConnection<Socket>, OnGatewayDisconnect<Socket> {
    private readonly logger = new Logger(SocketGateway.name);
    private server: Server;

    constructor(
        private readonly registrations: GatewayRegistrations,
        private readonly applicationConfig: ApplicationConfig,
    ) {}

    afterInit(server: Server) {
        this.server = server;
        this.registrations.handshakeMiddlewares().forEach((middleware) => server.use(this.toSocketIoMiddleware(middleware)));
        this.registrations
            .serverInitHooks()
            .forEach((hook) =>
                runSafely(() => hook(server)).catch((error) => this.logFailure('Server init hook failed', error)),
            );
    }

    handleConnection(socket: Socket) {
        this.logger.log(`Client connected: ${socket.id}`);
        this.bindEventHandlers(socket);
        this.runHooks('Connection hook', this.registrations.connectionHooks(), socket);
    }

    handleDisconnect(socket: Socket) {
        this.logger.log(`Client disconnected: ${socket.id}`);
        this.runHooks('Disconnect hook', this.registrations.disconnectHooks(), socket);
    }

    private bindEventHandlers(socket: Socket) {
        const handlers: WsMessageHandler[] = Array.from(this.registrations.eventHandlers(), ([event, handler]) => ({
            message: event,
            callback: (payload: unknown) => this.handle(event, handler, payload, socket),
            isAckHandledManually: false,
        }));
        this.applicationConfig
            .getIoAdapter()
            .bindMessageHandlers(socket, handlers, (response: Promise<unknown>) => from(response));
    }

    private async handle(event: string, handler: GatewayEventHandler, payload: unknown, socket: Socket) {
        try {
            return await handler(payload, this.contextOf(socket));
        } catch (error) {
            this.logFailure(`Handler of event "${event}" failed for client ${socket.id}`, error);
            return undefined;
        }
    }

    private runHooks(description: string, hooks: readonly GatewayConnectionHook[], socket: Socket) {
        const context = this.contextOf(socket);
        hooks.forEach((hook) =>
            runSafely(() => hook(context)).catch((error) =>
                this.logFailure(`${description} failed for client ${socket.id}`, error),
            ),
        );
    }

    private toSocketIoMiddleware(middleware: GatewayHandshakeMiddleware): SocketIoMiddleware {
        return (socket, next) => {
            runSafely(() => middleware(socket)).then(
                () => next(),
                (error: unknown) => next(this.toHandshakeRejection(error, socket)),
            );
        };
    }

    private toHandshakeRejection(error: unknown, socket: Socket): HandshakeRejectedError {
        if (error instanceof HandshakeRejectedError) {
            return error;
        }
        this.logFailure(`Handshake middleware failed for client ${socket.id}`, error);
        return new HandshakeRejectedError(GENERIC_HANDSHAKE_REJECTION);
    }

    private contextOf(socket: Socket): GatewayContext {
        return { socket, server: this.server };
    }

    private logFailure(description: string, error: unknown) {
        this.logger.error(`${description}: ${describeError(error)}`);
    }
}
