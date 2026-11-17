import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { handshakeAuthSchema, PROTOCOL_VERSION } from '../../../contracts';
import { isProtocolVersionSupported } from '../../../protocol/protocol-version';
import { GatewayContext, GatewayContributor, GatewayRegistry } from '../../gateway-registry';
import { HandshakeRejectedError } from '../../handshake-rejected.error';
import { clientAddressOf } from '../../session/client-address';
import { ConnectionLimiter } from '../../session/connection-limiter';
import { EventRateLimiter } from '../../session/event-rate-limiter';
import { CONNECTION_RETRY_AFTER_MS } from '../../session/limits';
import { ParticipantPresence } from '../../session/participant-presence';
import { RoomChangeSubscriber } from '../../session/room-change-subscriber';
import { SocketSessionRegistry } from '../../session/socket-session-registry';

@Injectable()
export class ConnectionHandlers implements GatewayContributor {
    constructor(
        private readonly sessions: SocketSessionRegistry,
        private readonly connections: ConnectionLimiter,
        private readonly eventLimiter: EventRateLimiter,
        private readonly presence: ParticipantPresence,
        private readonly subscriber: RoomChangeSubscriber,
    ) {}

    register(registry: GatewayRegistry): void {
        registry.useHandshake((socket) => this.admit(socket));
        registry.onConnection(({ socket }) => this.connections.add(socket.id, clientAddressOf(socket)));
        registry.onDisconnect((context) => this.release(context));
        registry.onServerInit((server) => this.subscriber.attach(server));
    }

    private admit(socket: Socket): void {
        const auth = handshakeAuthSchema.safeParse(socket.handshake.auth);
        if (!auth.success || !isProtocolVersionSupported(auth.data.protocolVersion, PROTOCOL_VERSION)) {
            throw new HandshakeRejectedError('protocol_version_unsupported', {
                code: 'protocol_version_unsupported',
                serverProtocolVersion: PROTOCOL_VERSION,
            });
        }
        if (this.connections.isFull(clientAddressOf(socket))) {
            throw new HandshakeRejectedError('rate_limited', {
                code: 'rate_limited',
                retryAfterMs: CONNECTION_RETRY_AFTER_MS,
            });
        }
    }

    private release({ socket }: GatewayContext): void {
        this.connections.remove(socket.id);
        this.eventLimiter.release(socket.id);
        const session = this.sessions.unbind(socket.id);
        if (session) this.presence.releaseSeat(session);
    }
}
