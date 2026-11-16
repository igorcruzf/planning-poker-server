import { Server, Socket } from 'socket.io';
import { PlanningPokerState } from '../../../planning-poker.state';
import { HIDDEN_VOTE } from '../../../vote';
import { GatewayRegistrations } from '../../gateway-registrations';
import { LegacyHandlers } from './legacy.handlers';

interface Emission {
    room: string;
    event: string;
    payload: unknown;
}

const createServer = (emissions: Emission[]) =>
    ({
        to: (room: string) => ({
            emit: (event: string, payload: unknown) => emissions.push({ room, event, payload }),
        }),
    } as unknown as Server);

const createSocket = (id: string) =>
    ({
        id,
        emit: jest.fn(),
        join: jest.fn(),
        leave: jest.fn(),
    } as unknown as Socket & { emit: jest.Mock; join: jest.Mock; leave: jest.Mock });

const mountLegacyArea = (emissions: Emission[]) => {
    const registrations = GatewayRegistrations.collect([new LegacyHandlers(new PlanningPokerState())]);
    const server = createServer(emissions);
    const send = (socket: Socket, event: string, payload: unknown) => {
        const handler = registrations.eventHandlers().get(event);
        if (!handler) {
            throw new Error(`The legacy area has no handler for "${event}"`);
        }
        return handler(payload, { socket, server });
    };
    const disconnect = (socket: Socket) =>
        registrations.disconnectHooks().forEach((hook) => hook({ socket, server }));
    return { registrations, send, disconnect };
};

describe('LegacyHandlers', () => {
    let emissions: Emission[];
    let legacy: ReturnType<typeof mountLegacyArea>;

    beforeEach(() => {
        emissions = [];
        legacy = mountLegacyArea(emissions);
    });

    it('registers exactly the legacy events login, update and reveal', () => {
        expect([...legacy.registrations.eventHandlers().keys()]).toEqual(['login', 'update', 'reveal']);
    });

    describe('login', () => {
        it('joins the room, sends the room users and broadcasts the login', () => {
            const socket = createSocket('s1');
            const user = { id: 'ana', room: 'A' };

            legacy.send(socket, 'login', user);

            expect(socket.join).toHaveBeenCalledWith('A');
            expect(socket.emit).toHaveBeenCalledWith('start', [user]);
            expect(socket.emit).not.toHaveBeenCalledWith('startReveal', true);
            expect(emissions).toEqual([{ room: 'A', event: 'login', payload: user }]);
        });

        it('sends startReveal when the room is already revealed', () => {
            const first = createSocket('s1');
            legacy.send(first, 'login', { id: 'ana', room: 'A' });
            legacy.send(first, 'reveal', true);

            const second = createSocket('s2');
            legacy.send(second, 'login', { id: 'bia', room: 'A' });

            expect(second.emit).toHaveBeenCalledWith('startReveal', true);
        });

        it('ignores payloads without id or room', () => {
            const socket = createSocket('s1');

            legacy.send(socket, 'login', { id: 'ana' });
            legacy.send(socket, 'login', null);

            expect(socket.join).not.toHaveBeenCalled();
            expect(emissions).toEqual([]);
        });

        it('leaves the previous room and notifies it when switching rooms', () => {
            const socket = createSocket('s1');
            legacy.send(socket, 'login', { id: 'ana', room: 'A' });
            emissions.length = 0;

            legacy.send(socket, 'login', { id: 'ana', room: 'B' });

            expect(socket.leave).toHaveBeenCalledWith('A');
            expect(emissions).toContainEqual({ room: 'A', event: 'logout', payload: { id: 'ana', room: 'A' } });
        });
    });

    describe('update', () => {
        it('broadcasts the update to the room of the logged user', () => {
            const socket = createSocket('s1');
            legacy.send(socket, 'login', { id: 'ana', room: 'A' });
            emissions.length = 0;

            legacy.send(socket, 'update', { id: 'ana', room: 'other', vote: 8 });

            expect(emissions).toEqual([{ room: 'A', event: 'update', payload: { id: 'ana', room: 'A', vote: 8 } }]);
        });

        it('registers a socket that sends a full user before logging in', () => {
            const socket = createSocket('s1');

            legacy.send(socket, 'update', { id: 'ana', room: 'A', vote: 2 });

            expect(socket.join).toHaveBeenCalledWith('A');
            expect(emissions).toEqual([{ room: 'A', event: 'update', payload: { id: 'ana', room: 'A', vote: 2 } }]);
        });

        it('ignores partial updates from sockets without login', () => {
            legacy.send(createSocket('s1'), 'update', { vote: 2 });

            expect(emissions).toEqual([]);
        });
    });

    describe('hidden votes', () => {
        it('hides the vote in login, start and update until the cards are revealed', () => {
            const ana = createSocket('s1');
            const bia = createSocket('s2');
            legacy.send(ana, 'login', { id: 'ana', room: 'A', votedValue: 'G' });
            legacy.send(bia, 'login', { id: 'bia', room: 'A', votedValue: '' });
            legacy.send(bia, 'update', { id: 'bia', room: 'A', votedValue: 'P' });

            expect(bia.emit).toHaveBeenCalledWith('start', [
                { id: 'ana', room: 'A', votedValue: HIDDEN_VOTE },
                { id: 'bia', room: 'A', votedValue: '' },
            ]);
            expect(emissions).toEqual([
                { room: 'A', event: 'login', payload: { id: 'ana', room: 'A', votedValue: HIDDEN_VOTE } },
                { room: 'A', event: 'login', payload: { id: 'bia', room: 'A', votedValue: '' } },
                { room: 'A', event: 'update', payload: { id: 'bia', room: 'A', votedValue: HIDDEN_VOTE } },
            ]);
        });

        it('sends the real votes to the room before the reveal event', () => {
            const ana = createSocket('s1');
            const bia = createSocket('s2');
            legacy.send(ana, 'login', { id: 'ana', room: 'A', votedValue: 'G' });
            legacy.send(bia, 'login', { id: 'bia', room: 'A', votedValue: 'P' });
            emissions.length = 0;

            legacy.send(ana, 'reveal', true);

            expect(emissions).toEqual([
                { room: 'A', event: 'update', payload: { id: 'ana', room: 'A', votedValue: 'G' } },
                { room: 'A', event: 'update', payload: { id: 'bia', room: 'A', votedValue: 'P' } },
                { room: 'A', event: 'reveal', payload: true },
            ]);
        });

        it('sends the real votes to whoever joins after the reveal', () => {
            const ana = createSocket('s1');
            legacy.send(ana, 'login', { id: 'ana', room: 'A', votedValue: 'G' });
            legacy.send(ana, 'reveal', true);

            const bia = createSocket('s2');
            legacy.send(bia, 'login', { id: 'bia', room: 'A', votedValue: '' });

            expect(bia.emit).toHaveBeenCalledWith('start', [
                { id: 'ana', room: 'A', votedValue: 'G' },
                { id: 'bia', room: 'A', votedValue: '' },
            ]);
        });

        it('hides the vote of a user that logs out', () => {
            const socket = createSocket('s1');
            legacy.send(socket, 'login', { id: 'ana', room: 'A', votedValue: 'M' });
            emissions.length = 0;

            legacy.disconnect(socket);

            expect(emissions).toEqual([
                { room: 'A', event: 'logout', payload: { id: 'ana', room: 'A', votedValue: HIDDEN_VOTE } },
            ]);
        });
    });

    describe('new round', () => {
        it('clears every vote of the room and broadcasts it before hiding the cards', () => {
            const ana = createSocket('s1');
            const bia = createSocket('s2');
            legacy.send(ana, 'login', { id: 'ana', room: 'A', votedValue: 'G' });
            legacy.send(bia, 'login', { id: 'bia', room: 'A', votedValue: 'P' });
            legacy.send(ana, 'reveal', true);
            emissions.length = 0;

            legacy.send(bia, 'reveal', false);

            expect(emissions).toEqual([
                { room: 'A', event: 'update', payload: { id: 'ana', room: 'A', votedValue: '' } },
                { room: 'A', event: 'update', payload: { id: 'bia', room: 'A', votedValue: '' } },
                { room: 'A', event: 'reveal', payload: false },
            ]);
        });

        it('hides the votes of the new round again', () => {
            const ana = createSocket('s1');
            legacy.send(ana, 'login', { id: 'ana', room: 'A', votedValue: 'G' });
            legacy.send(ana, 'reveal', true);
            legacy.send(ana, 'reveal', false);
            emissions.length = 0;

            legacy.send(ana, 'update', { id: 'ana', room: 'A', votedValue: 'PP' });

            expect(emissions).toEqual([
                { room: 'A', event: 'update', payload: { id: 'ana', room: 'A', votedValue: HIDDEN_VOTE } },
            ]);
        });
    });

    describe('reveal', () => {

        it('ignores non boolean payloads', () => {
            const socket = createSocket('s1');
            legacy.send(socket, 'login', { id: 'ana', room: 'A' });
            emissions.length = 0;

            legacy.send(socket, 'reveal', 'true');

            expect(emissions).toEqual([]);
        });
    });

    describe('disconnect', () => {
        it('broadcasts logout when the last socket of the user disconnects', () => {
            const socket = createSocket('s1');
            legacy.send(socket, 'login', { id: 'ana', room: 'A' });
            emissions.length = 0;

            legacy.disconnect(socket);

            expect(emissions).toEqual([{ room: 'A', event: 'logout', payload: { id: 'ana', room: 'A' } }]);
        });

        it('keeps the user online while another socket of the same user is connected', () => {
            const oldSocket = createSocket('s1');
            const newSocket = createSocket('s2');
            legacy.send(oldSocket, 'login', { id: 'ana', room: 'A' });
            legacy.send(newSocket, 'login', { id: 'ana', room: 'A' });
            emissions.length = 0;

            legacy.disconnect(oldSocket);

            expect(emissions).toEqual([]);
        });
    });
});
