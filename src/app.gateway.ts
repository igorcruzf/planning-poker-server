import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { corsOrigin } from './cors-origin';
import { Departure, PlanningPokerState } from './planning-poker.state';
import { isUserChanges, isUserInfo, toKey, UserInfo } from './user-info';
import { hideVote } from './vote';

@WebSocketGateway({ cors: { origin: corsOrigin() } })
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    private readonly server: Server;

    private readonly logger = new Logger(AppGateway.name);

    constructor(private readonly state: PlanningPokerState) {}

    handleConnection(client: Socket) {
        this.logger.log(`Client connected: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
        this.notifyDeparture(this.state.leave(client.id));
    }

    @SubscribeMessage('login')
    handleLoginEvent(@ConnectedSocket() client: Socket, @MessageBody() userInfo: unknown) {
        if (!isUserInfo(userInfo)) {
            this.logger.warn(`Invalid login payload from ${client.id}`);
            return;
        }
        this.logger.log(`Login of user ${userInfo.id} in room ${userInfo.room}`);

        const room = toKey(userInfo.room);
        this.joinRoom(client, room, userInfo);
        client.emit('start', this.visibleUsersIn(room));
        if (this.state.isRevealed(room)) {
            client.emit('startReveal', true);
        }
        this.server.to(room).emit('login', this.visibleUser(room, userInfo));
    }

    @SubscribeMessage('update')
    handleUpdateEvent(@ConnectedSocket() client: Socket, @MessageBody() changes: unknown) {
        if (!isUserChanges(changes)) {
            this.logger.warn(`Invalid update payload from ${client.id}`);
            return;
        }

        let user = this.state.update(client.id, changes);
        if (!user && isUserInfo(changes)) {
            this.joinRoom(client, toKey(changes.room), changes);
            user = changes;
        }
        if (!user) {
            this.logger.warn(`Update from client ${client.id} without login`);
            return;
        }
        const room = toKey(user.room);
        this.server.to(room).emit('update', this.visibleUser(room, user));
    }

    @SubscribeMessage('reveal')
    handleRevealEvent(@ConnectedSocket() client: Socket, @MessageBody() shouldReveal: unknown) {
        if (typeof shouldReveal !== 'boolean') {
            this.logger.warn(`Invalid reveal payload from ${client.id}`);
            return;
        }

        const room = shouldReveal ? this.state.reveal(client.id) : this.state.startNewRound(client.id);
        if (room === undefined) {
            this.logger.warn(`Reveal from client ${client.id} without login`);
            return;
        }
        this.logger.log(shouldReveal ? `Votes revealed in room ${room}` : `New round started in room ${room}`);
        this.state.usersIn(room).forEach((user) => this.server.to(room).emit('update', user));
        this.server.to(room).emit('reveal', shouldReveal);
    }

    private visibleUsersIn(room: string): UserInfo[] {
        return this.state.usersIn(room).map((user) => this.visibleUser(room, user));
    }

    private visibleUser(room: string, user: UserInfo): UserInfo {
        return this.state.isRevealed(room) ? user : hideVote(user);
    }

    private joinRoom(client: Socket, room: string, userInfo: UserInfo) {
        const departure = this.state.join(client.id, userInfo);
        if (departure && departure.room !== room) {
            client.leave(departure.room);
        }
        this.notifyDeparture(departure);
        client.join(room);
    }

    private notifyDeparture(departure: Departure | undefined) {
        if (departure?.lastConnection) {
            this.server.to(departure.room).emit('logout', hideVote(departure.user));
        }
    }
}
