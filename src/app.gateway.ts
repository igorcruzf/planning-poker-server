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
        client.emit('start', this.state.usersIn(room));
        if (this.state.isRevealed(room)) {
            client.emit('startReveal', true);
        }
        this.server.to(room).emit('login', userInfo);
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
        this.server.to(toKey(user.room)).emit('update', user);
    }

    @SubscribeMessage('reveal')
    handleRevealEvent(@ConnectedSocket() client: Socket, @MessageBody() shouldReveal: unknown) {
        if (typeof shouldReveal !== 'boolean') {
            this.logger.warn(`Invalid reveal payload from ${client.id}`);
            return;
        }

        const room = this.state.setRevealed(client.id, shouldReveal);
        if (room === undefined) {
            this.logger.warn(`Reveal from client ${client.id} without login`);
            return;
        }
        this.logger.log(`Reveal set to ${shouldReveal} in room ${room}`);
        this.server.to(room).emit('reveal', shouldReveal);
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
            this.server.to(departure.room).emit('logout', departure.user);
        }
    }
}
