import {
    GatewayConnectionHook,
    GatewayContributor,
    GatewayEventHandler,
    GatewayHandshakeMiddleware,
    GatewayRegistry,
    GatewayServerInitHook,
} from './gateway-registry';

const SOCKET_IO_RESERVED_EVENTS = new Set([
    'connect',
    'connect_error',
    'disconnect',
    'disconnecting',
    'newListener',
    'removeListener',
]);

export class GatewayRegistrations implements GatewayRegistry {
    private readonly handlers = new Map<string, GatewayEventHandler>();
    private readonly middlewares: GatewayHandshakeMiddleware[] = [];
    private readonly connections: GatewayConnectionHook[] = [];
    private readonly disconnections: GatewayConnectionHook[] = [];
    private readonly serverInits: GatewayServerInitHook[] = [];

    static collect(contributors: readonly GatewayContributor[]): GatewayRegistrations {
        const registrations = new GatewayRegistrations();
        contributors.forEach((contributor) => contributor.register(registrations));
        return registrations;
    }

    on(event: string, handler: GatewayEventHandler): void {
        this.assertRegistrable(event);
        this.handlers.set(event, handler);
    }

    useHandshake(middleware: GatewayHandshakeMiddleware): void {
        this.middlewares.push(middleware);
    }

    onConnection(hook: GatewayConnectionHook): void {
        this.connections.push(hook);
    }

    onDisconnect(hook: GatewayConnectionHook): void {
        this.disconnections.push(hook);
    }

    onServerInit(hook: GatewayServerInitHook): void {
        this.serverInits.push(hook);
    }

    eventHandlers(): ReadonlyMap<string, GatewayEventHandler> {
        return new Map(this.handlers);
    }

    handshakeMiddlewares(): readonly GatewayHandshakeMiddleware[] {
        return [...this.middlewares];
    }

    connectionHooks(): readonly GatewayConnectionHook[] {
        return [...this.connections];
    }

    disconnectHooks(): readonly GatewayConnectionHook[] {
        return [...this.disconnections];
    }

    serverInitHooks(): readonly GatewayServerInitHook[] {
        return [...this.serverInits];
    }

    private assertRegistrable(event: string): void {
        if (event.trim().length === 0) {
            throw new Error('Gateway event name must not be blank');
        }
        if (SOCKET_IO_RESERVED_EVENTS.has(event)) {
            throw new Error(`Gateway event "${event}" is reserved by Socket.IO`);
        }
        if (this.handlers.has(event)) {
            throw new Error(`Gateway event "${event}" is already registered`);
        }
    }
}
