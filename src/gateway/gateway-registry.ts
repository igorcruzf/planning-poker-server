import { Server, Socket } from 'socket.io';

export interface GatewayContext {
    readonly socket: Socket;
    readonly server: Server;
}

export type GatewayEventHandler = (payload: unknown, context: GatewayContext) => unknown;

export type GatewayHandshakeMiddleware = (socket: Socket) => void | Promise<void>;

export type GatewayConnectionHook = (context: GatewayContext) => void | Promise<void>;

export type GatewayServerInitHook = (server: Server) => void;

export interface GatewayRegistry {
    on(event: string, handler: GatewayEventHandler): void;
    useHandshake(middleware: GatewayHandshakeMiddleware): void;
    onConnection(hook: GatewayConnectionHook): void;
    onDisconnect(hook: GatewayConnectionHook): void;
    onServerInit(hook: GatewayServerInitHook): void;
}

export interface GatewayContributor {
    register(registry: GatewayRegistry): void;
}
