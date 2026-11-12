import { Server, Socket } from 'socket.io';
import { AppGateway } from './app.gateway';
import { PlanningPokerState } from './planning-poker.state';
import { HIDDEN_VOTE } from './vote';

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

    describe('hidden votes', () => {
        it('hides the vote in login, start and update until the cards are revealed', () => {
            const ana = createSocket('s1');
            const bia = createSocket('s2');
            gateway.handleLoginEvent(ana, { id: 'ana', room: 'A', votedValue: 'G' });
            gateway.handleLoginEvent(bia, { id: 'bia', room: 'A', votedValue: '' });
            gateway.handleUpdateEvent(bia, { id: 'bia', room: 'A', votedValue: 'P' });

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
            gateway.handleLoginEvent(ana, { id: 'ana', room: 'A', votedValue: 'G' });
            gateway.handleLoginEvent(bia, { id: 'bia', room: 'A', votedValue: 'P' });
            emissions.length = 0;

            gateway.handleRevealEvent(ana, true);

            expect(emissions).toEqual([
                { room: 'A', event: 'update', payload: { id: 'ana', room: 'A', votedValue: 'G' } },
                { room: 'A', event: 'update', payload: { id: 'bia', room: 'A', votedValue: 'P' } },
                { room: 'A', event: 'reveal', payload: true },
            ]);
        });

        it('sends the real votes to whoever joins after the reveal', () => {
            const ana = createSocket('s1');
            gateway.handleLoginEvent(ana, { id: 'ana', room: 'A', votedValue: 'G' });
            gateway.handleRevealEvent(ana, true);

            const bia = createSocket('s2');
            gateway.handleLoginEvent(bia, { id: 'bia', room: 'A', votedValue: '' });

            expect(bia.emit).toHaveBeenCalledWith('start', [
                { id: 'ana', room: 'A', votedValue: 'G' },
                { id: 'bia', room: 'A', votedValue: '' },
            ]);
        });

        it('hides the vote of a user that logs out', () => {
            const socket = createSocket('s1');
            gateway.handleLoginEvent(socket, { id: 'ana', room: 'A', votedValue: 'M' });
            emissions.length = 0;

            gateway.handleDisconnect(socket);

            expect(emissions).toEqual([
                { room: 'A', event: 'logout', payload: { id: 'ana', room: 'A', votedValue: HIDDEN_VOTE } },
            ]);
        });
    });

    describe('new round', () => {
        it('clears every vote of the room and broadcasts it before hiding the cards', () => {
            const ana = createSocket('s1');
            const bia = createSocket('s2');
            gateway.handleLoginEvent(ana, { id: 'ana', room: 'A', votedValue: 'G' });
            gateway.handleLoginEvent(bia, { id: 'bia', room: 'A', votedValue: 'P' });
            gateway.handleRevealEvent(ana, true);
            emissions.length = 0;

            gateway.handleRevealEvent(bia, false);

            expect(emissions).toEqual([
                { room: 'A', event: 'update', payload: { id: 'ana', room: 'A', votedValue: '' } },
                { room: 'A', event: 'update', payload: { id: 'bia', room: 'A', votedValue: '' } },
                { room: 'A', event: 'reveal', payload: false },
            ]);
        });

        it('hides the votes of the new round again', () => {
            const ana = createSocket('s1');
            gateway.handleLoginEvent(ana, { id: 'ana', room: 'A', votedValue: 'G' });
            gateway.handleRevealEvent(ana, true);
            gateway.handleRevealEvent(ana, false);
            emissions.length = 0;

            gateway.handleUpdateEvent(ana, { id: 'ana', room: 'A', votedValue: 'PP' });

            expect(emissions).toEqual([
                { room: 'A', event: 'update', payload: { id: 'ana', room: 'A', votedValue: HIDDEN_VOTE } },
            ]);
        });
    });

    describe('reveal', () => {

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
