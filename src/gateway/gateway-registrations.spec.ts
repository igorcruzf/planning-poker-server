import { GatewayContributor, GatewayRegistry } from './gateway-registry';
import { GatewayRegistrations } from './gateway-registrations';

const contributorOf = (register: (registry: GatewayRegistry) => void): GatewayContributor => ({ register });

describe('GatewayRegistrations', () => {
    let registrations: GatewayRegistrations;

    beforeEach(() => {
        registrations = new GatewayRegistrations();
    });

    it('keeps one handler per event and lists the events in registration order', () => {
        const join = jest.fn();
        const vote = jest.fn();

        registrations.on('room:join', join);
        registrations.on('round:vote', vote);

        expect([...registrations.eventHandlers().keys()]).toEqual(['room:join', 'round:vote']);
        expect(registrations.eventHandlers().get('room:join')).toBe(join);
        expect(registrations.eventHandlers().get('round:vote')).toBe(vote);
    });

    it('has no handler for an event that was not registered', () => {
        expect(registrations.eventHandlers().get('unknown')).toBeUndefined();
    });

    it('rejects an event registered twice', () => {
        registrations.on('room:join', jest.fn());

        expect(() => registrations.on('room:join', jest.fn())).toThrow('Gateway event "room:join" is already registered');
    });

    it.each(['connect', 'connect_error', 'disconnect', 'disconnecting', 'newListener', 'removeListener'])(
        'rejects the reserved Socket.IO event %s',
        (event) => {
            expect(() => registrations.on(event, jest.fn())).toThrow(`Gateway event "${event}" is reserved by Socket.IO`);
        },
    );

    it('rejects a blank event name', () => {
        expect(() => registrations.on('  ', jest.fn())).toThrow('Gateway event name must not be blank');
    });

    it('keeps handshake middlewares and lifecycle hooks in registration order', () => {
        const [firstMiddleware, secondMiddleware] = [jest.fn(), jest.fn()];
        const [firstConnection, secondConnection] = [jest.fn(), jest.fn()];
        const [firstDisconnect, secondDisconnect] = [jest.fn(), jest.fn()];
        const [firstInit, secondInit] = [jest.fn(), jest.fn()];

        registrations.useHandshake(firstMiddleware);
        registrations.useHandshake(secondMiddleware);
        registrations.onConnection(firstConnection);
        registrations.onConnection(secondConnection);
        registrations.onDisconnect(firstDisconnect);
        registrations.onDisconnect(secondDisconnect);
        registrations.onServerInit(firstInit);
        registrations.onServerInit(secondInit);

        expect(registrations.handshakeMiddlewares()).toEqual([firstMiddleware, secondMiddleware]);
        expect(registrations.connectionHooks()).toEqual([firstConnection, secondConnection]);
        expect(registrations.disconnectHooks()).toEqual([firstDisconnect, secondDisconnect]);
        expect(registrations.serverInitHooks()).toEqual([firstInit, secondInit]);
    });

    it('collects what every contributor registers, in the contributors order', () => {
        const join = jest.fn();
        const vote = jest.fn();

        const collected = GatewayRegistrations.collect([
            contributorOf((registry) => registry.on('room:join', join)),
            contributorOf((registry) => registry.on('round:vote', vote)),
        ]);

        expect([...collected.eventHandlers().keys()]).toEqual(['room:join', 'round:vote']);
        expect(collected.eventHandlers().get('round:vote')).toBe(vote);
    });
});
