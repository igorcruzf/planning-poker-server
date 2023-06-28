import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, MessageBody, ConnectedSocket} from '@nestjs/websockets';
import {Logger} from "@nestjs/common";

@WebSocketGateway( {
    cors: {
        origin: '*',
    },
})
export class AppGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {

    @WebSocketServer()
    server;

    private logger: Logger = new Logger('AppGateway');
    private users = [];

    handleConnection(@ConnectedSocket() client: any) {
        this.logger.log('Client connected');
    }

    handleDisconnect(@ConnectedSocket() client: any) {
        this.logger.log('Client disconnected');
        const index = this.users.findIndex((f) => client === f[0]);
        this.logger.log("Client with index: ", index)
        if(index !== -1) {
            this.server.emit('logout', this.users[index][1])
            this.users = [...this.users.slice(0, index), ...this.users.slice(index + 1)];
        }
    }

    afterInit(server: any): any {
        this.logger.log('init');
    }

    @SubscribeMessage('login')
    handleLoginEvent(@ConnectedSocket() client, @MessageBody() userInfo: any) {
        this.logger.log('Received login:', JSON.stringify(userInfo));
        if(this.users.filter( (user) => user[1].id === userInfo.id).length === 0) {
            this.users.push([client, userInfo]);
        }
        client.emit('start', this.users.map( (user) => user[1]))
        this.server.emit('login', userInfo);
    }

    @SubscribeMessage('update')
    handleUpdateEvent(@ConnectedSocket() client, @MessageBody() userInfo: any) {
        this.logger.log('Received update:', JSON.stringify(userInfo));
        this.users = this.addOrUpdateField(client, userInfo)
        this.server.emit('update', userInfo);
    }

    @SubscribeMessage('reveal')
    handleRevealEvent(@ConnectedSocket() client, @MessageBody() shouldReveal: boolean) {
        this.logger.log('Received reveal event:', shouldReveal);
        this.server.emit('reveal', shouldReveal);
    }
    addOrUpdateField(
        client: any,
        userInfo: any
    ): any[] {
        const index = this.users.findIndex((f) => userInfo.id === f[1].id);

        if (-1 === index) {
            return [...(this.users), [client, userInfo]];
        }

        return [...this.users.slice(0, index), [client, userInfo], ...this.users.slice(index + 1)];
    }
}


