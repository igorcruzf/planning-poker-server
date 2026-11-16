import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Departure, PlanningPokerState } from '../../../planning-poker.state';
import { isUserChanges, isUserInfo, toKey, UserInfo } from '../../../user-info';
import { hideVote } from '../../../vote';
import { GatewayContext, GatewayContributor, GatewayRegistry } from '../../gateway-registry';

@Injectable()
export class LegacyHandlers implements GatewayContributor {
    private readonly logger = new Logger(LegacyHandlers.name);

    constructor(private readonly state: PlanningPokerState) {}

    register(registry: GatewayRegistry): void {
        registry.on('login', (userInfo, context) => this.handleLogin(userInfo, context));
        registry.on('update', (changes, context) => this.handleUpdate(changes, context));
        registry.on('reveal', (shouldReveal, context) => this.handleReveal(shouldReveal, context));
        registry.onDisconnect((context) => this.handleDisconnect(context));
    }

    private handleDisconnect({ socket, server }: GatewayContext) {
        this.notifyDeparture(server, this.state.leave(socket.id));
    }

    private handleLogin(userInfo: unknown, { socket, server }: GatewayContext) {
        if (!isUserInfo(userInfo)) {
            this.logger.warn(`Invalid login payload from ${socket.id}`);
            return;
        }
        this.logger.log(`Login of user ${userInfo.id} in room ${userInfo.room}`);
        const room = toKey(userInfo.room);
        this.joinRoom(socket, server, room, userInfo);
        socket.emit('start', this.visibleUsersIn(room));
        if (this.state.isRevealed(room)) {
            socket.emit('startReveal', true);
        }
        server.to(room).emit('login', this.visibleUser(room, userInfo));
    }

    private handleUpdate(changes: unknown, { socket, server }: GatewayContext) {
        if (!isUserChanges(changes)) {
            this.logger.warn(`Invalid update payload from ${socket.id}`);
            return;
        }
        let user = this.state.update(socket.id, changes);
        if (!user && isUserInfo(changes)) {
            this.joinRoom(socket, server, toKey(changes.room), changes);
            user = changes;
        }
        if (!user) {
            this.logger.warn(`Update from client ${socket.id} without login`);
            return;
        }
        const room = toKey(user.room);
        server.to(room).emit('update', this.visibleUser(room, user));
    }

    private handleReveal(shouldReveal: unknown, { socket, server }: GatewayContext) {
        if (typeof shouldReveal !== 'boolean') {
            this.logger.warn(`Invalid reveal payload from ${socket.id}`);
            return;
        }
        const room = shouldReveal ? this.state.reveal(socket.id) : this.state.startNewRound(socket.id);
        if (room === undefined) {
            this.logger.warn(`Reveal from client ${socket.id} without login`);
            return;
        }
        this.logger.log(shouldReveal ? `Votes revealed in room ${room}` : `New round started in room ${room}`);
        this.state.usersIn(room).forEach((user) => server.to(room).emit('update', user));
        server.to(room).emit('reveal', shouldReveal);
    }

    private visibleUsersIn(room: string): UserInfo[] {
        return this.state.usersIn(room).map((user) => this.visibleUser(room, user));
    }

    private visibleUser(room: string, user: UserInfo): UserInfo {
        return this.state.isRevealed(room) ? user : hideVote(user);
    }

    private joinRoom(socket: Socket, server: Server, room: string, userInfo: UserInfo) {
        const departure = this.state.join(socket.id, userInfo);
        if (departure && departure.room !== room) {
            socket.leave(departure.room);
        }
        this.notifyDeparture(server, departure);
        socket.join(room);
    }

    private notifyDeparture(server: Server, departure: Departure | undefined) {
        if (departure?.lastConnection) {
            server.to(departure.room).emit('logout', hideVote(departure.user));
        }
    }
}
