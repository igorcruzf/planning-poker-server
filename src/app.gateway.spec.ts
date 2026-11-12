import { Server, Socket } from 'socket.io';
import { AppGateway } from './app.gateway';
import { PlanningPokerState } from './planning-poker.state';

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

describe('AppGateway', () => {
    let emissions: Emission[];
    let gateway: AppGateway;

    beforeEach(() => {
        emissions = [];
        gateway = new AppGateway(new PlanningPokerState());
        Object.assign(gateway, { server: createServer(emissions) });
    });

    describe('login', () => {
        it('joins the room, sends the room users and broadcasts the login', () => {
            const socket = createSocket('s1');
            const user = { id: 'ana', room: 'A' };

            gateway.handleLoginEvent(socket, user);

            expect(socket.join).toHaveBeenCalledWith('A');
            expect(socket.emit).toHaveBeenCalledWith('start', [user]);
            expect(socket.emit).not.toHaveBeenCalledWith('startReveal', true);
            expect(emissions).toEqual([{ room: 'A', event: 'login', payload: user }]);
        });

        it('sends startReveal when the room is already revealed', () => {
            const first = createSocket('s1');
            gateway.handleLoginEvent(first, { id: 'ana', room: 'A' });
            gateway.handleRevealEvent(first, true);

            const second = createSocket('s2');
            gateway.handleLoginEvent(second, { id: 'bia', room: 'A' });

            expect(second.emit).toHaveBeenCalledWith('startReveal', true);
        });

        it('ignores payloads without id or room', () => {
            const socket = createSocket('s1');

            gateway.handleLoginEvent(socket, { id: 'ana' });
            gateway.handleLoginEvent(socket, null);

            expect(socket.join).not.toHaveBeenCalled();
            expect(emissions).toEqual([]);
        });

        it('leaves the previous room and notifies it when switching rooms', () => {
            const socket = createSocket('s1');
            gateway.handleLoginEvent(socket, { id: 'ana', room: 'A' });
            emissions.length = 0;

            gateway.handleLoginEvent(socket, { id: 'ana', room: 'B' });

            expect(socket.leave).toHaveBeenCalledWith('A');
            expect(emissions).toContainEqual({ room: 'A', event: 'logout', payload: { id: 'ana', room: 'A' } });
        });
    });

    describe('update', () => {
        it('broadcasts the update to the room of the logged user', () => {
            const socket = createSocket('s1');
            gateway.handleLoginEvent(socket, { id: 'ana', room: 'A' });
            emissions.length = 0;

            gateway.handleUpdateEvent(socket, { id: 'ana', room: 'other', vote: 8 });

            expect(emissions).toEqual([{ room: 'A', event: 'update', payload: { id: 'ana', room: 'A', vote: 8 } }]);
        });

        it('registers a socket that sends a full user before logging in', () => {
            const socket = createSocket('s1');

            gateway.handleUpdateEvent(socket, { id: 'ana', room: 'A', vote: 2 });

            expect(socket.join).toHaveBeenCalledWith('A');
            expect(emissions).toEqual([{ room: 'A', event: 'update', payload: { id: 'ana', room: 'A', vote: 2 } }]);
        });

        it('ignores partial updates from sockets without login', () => {
            gateway.handleUpdateEvent(createSocket('s1'), { vote: 2 });

            expect(emissions).toEqual([]);
        });
    });

    describe('reveal', () => {
        it('broadcasts the reveal to the room of the user', () => {
            const socket = createSocket('s1');
            gateway.handleLoginEvent(socket, { id: 'ana', room: 'A' });
            emissions.length = 0;

            gateway.handleRevealEvent(socket, true);

            expect(emissions).toEqual([{ room: 'A', event: 'reveal', payload: true }]);
        });

        it('ignores non boolean payloads', () => {
            const socket = createSocket('s1');
            gateway.handleLoginEvent(socket, { id: 'ana', room: 'A' });
            emissions.length = 0;

            gateway.handleRevealEvent(socket, 'true');

            expect(emissions).toEqual([]);
        });
    });

    describe('disconnect', () => {
        it('broadcasts logout when the last socket of the user disconnects', () => {
            const socket = createSocket('s1');
            gateway.handleLoginEvent(socket, { id: 'ana', room: 'A' });
            emissions.length = 0;

            gateway.handleDisconnect(socket);

            expect(emissions).toEqual([{ room: 'A', event: 'logout', payload: { id: 'ana', room: 'A' } }]);
        });

        it('keeps the user online while another socket of the same user is connected', () => {
            const oldSocket = createSocket('s1');
            const newSocket = createSocket('s2');
            gateway.handleLoginEvent(oldSocket, { id: 'ana', room: 'A' });
            gateway.handleLoginEvent(newSocket, { id: 'ana', room: 'A' });
            emissions.length = 0;

            gateway.handleDisconnect(oldSocket);

            expect(emissions).toEqual([]);
        });
    });
});
