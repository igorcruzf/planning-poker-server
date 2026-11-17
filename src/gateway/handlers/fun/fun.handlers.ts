import { randomInt, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
    FUN_REACTION_WINDOW_MS,
    FUN_REACTIONS_PER_WINDOW,
    FUN_SEED_MAX,
    FUN_THROW_WINDOW_MS,
    FUN_THROWS_PER_WINDOW,
    FunReacted,
    FunThrown,
} from '../../../contracts';
import { Clock } from '../../../domain/clock';
import { DomainError, domainErrors } from '../../../domain/domain-error';
import { RoomService } from '../../../domain/room.service';
import { GatewayContext, GatewayContributor, GatewayRegistry } from '../../gateway-registry';
import { ClientEventRunner } from '../../session/client-event-runner';
import { RateLimiter } from '../../session/rate-limiter';
import { ParticipantSession, SocketSessionRegistry } from '../../session/socket-session-registry';

@Injectable()
export class FunHandlers implements GatewayContributor {
    private readonly throwLimiter: RateLimiter;
    private readonly reactionLimiter: RateLimiter;

    constructor(
        private readonly rooms: RoomService,
        private readonly sessions: SocketSessionRegistry,
        private readonly runner: ClientEventRunner,
        private readonly clock: Clock,
    ) {
        this.throwLimiter = new RateLimiter({ limit: FUN_THROWS_PER_WINDOW, windowMs: FUN_THROW_WINDOW_MS }, clock);
        this.reactionLimiter = new RateLimiter(
            { limit: FUN_REACTIONS_PER_WINDOW, windowMs: FUN_REACTION_WINDOW_MS },
            clock,
        );
    }

    register(registry: GatewayRegistry): void {
        registry.on('fun:throw', (payload, { socket, server }) =>
            this.runner.run('fun:throw', payload, socket, ({ targetId }) => {
                const session = this.sessions.require(socket.id);
                const thrown = this.prepareThrow(session, targetId);
                this.consume(this.throwLimiter, session);
                this.broadcast(server, session.roomCode, 'fun:thrown', thrown);
                return null;
            }),
        );
        registry.on('fun:umbrella', (payload, { socket }) =>
            this.runner.run('fun:umbrella', payload, socket, ({ enabled }) => {
                const { roomCode, participantId } = this.sessions.require(socket.id);
                this.rooms.setUmbrella(roomCode, participantId, enabled);
                return null;
            }),
        );
        registry.on('fun:react', (payload, { socket, server }) =>
            this.runner.run('fun:react', payload, socket, ({ reaction }) => {
                const session = this.sessions.require(socket.id);
                this.consume(this.reactionLimiter, session);
                const reacted: FunReacted = {
                    id: randomUUID(),
                    fromId: session.participantId,
                    reaction,
                    reactedAt: this.clock.now(),
                };
                this.broadcast(server, session.roomCode, 'fun:reacted', reacted);
                return null;
            }),
        );
    }

    private prepareThrow({ roomCode, participantId }: ParticipantSession, targetId: string): FunThrown {
        const target = this.rooms.getRoom(roomCode).findParticipant(targetId);
        if (!target || target.id === participantId) throw domainErrors.invalidTarget();
        return {
            id: randomUUID(),
            seed: randomInt(FUN_SEED_MAX + 1),
            fromId: participantId,
            targetId: target.id,
            blockedByUmbrella: target.umbrella,
            thrownAt: this.clock.now(),
        };
    }

    private consume(limiter: RateLimiter, { roomCode, participantId }: ParticipantSession): void {
        const retryAfterMs = limiter.consume(`${roomCode}:${participantId}`);
        if (retryAfterMs !== null) throw new DomainError({ code: 'rate_limited', retryAfterMs });
    }

    private broadcast(server: GatewayContext['server'], roomCode: string, event: string, payload: unknown): void {
        this.sessions.socketsOf(roomCode).forEach(({ socketId }) => server.to(socketId).emit(event, payload));
    }
}
