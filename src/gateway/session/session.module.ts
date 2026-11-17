import { Module } from '@nestjs/common';
import { DomainModule } from '../../domain/domain.module';
import { ClientEventRunner } from './client-event-runner';
import { ConnectionLimiter } from './connection-limiter';
import { EventRateLimiter } from './event-rate-limiter';
import { ParticipantPresence } from './participant-presence';
import { RoomBroadcaster } from './room-broadcaster';
import { RoomChangeSubscriber } from './room-change-subscriber';
import { RoomTimers } from './room-timers';
import { Scheduler, SystemScheduler } from './scheduler';
import { SocketSessionRegistry } from './socket-session-registry';

const SESSION_SERVICES = [
    SocketSessionRegistry,
    RoomBroadcaster,
    RoomChangeSubscriber,
    RoomTimers,
    ParticipantPresence,
    ClientEventRunner,
    EventRateLimiter,
    ConnectionLimiter,
];

@Module({
    imports: [DomainModule],
    providers: [{ provide: Scheduler, useClass: SystemScheduler }, ...SESSION_SERVICES],
    exports: [Scheduler, ...SESSION_SERVICES],
})
export class SessionModule {}
