import { Inject, Injectable } from '@nestjs/common';
import { RoomService } from '../../../domain/room.service';
import { GatewayContributor, GatewayRegistry } from '../../gateway-registry';
import { ClientEventRunner } from '../../session/client-event-runner';
import { SocketSessionRegistry } from '../../session/socket-session-registry';
import { KIRO_MCP_URL } from './mcp-url';
@Injectable()
export class KiroHandlers implements GatewayContributor {
    constructor(
        private readonly rooms: RoomService,
        private readonly sessions: SocketSessionRegistry,
        private readonly runner: ClientEventRunner,
        @Inject(KIRO_MCP_URL) private readonly mcpUrl: string,
    ) {}
    register(registry: GatewayRegistry): void {
        registry.on('kiro:invite', (payload, { socket }) =>
            this.runner.run('kiro:invite', payload, socket, () => {
                const { roomCode, participantId } = this.sessions.require(socket.id);
                const { inviteCode, expiresAt } = this.rooms.createKiroInvite(roomCode, participantId);
                return { inviteCode, mcpUrl: this.mcpUrl, expiresAt };
            }),
        );
    }
}
