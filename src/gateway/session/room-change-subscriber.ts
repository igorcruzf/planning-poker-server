import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'socket.io';
import { RoomService } from '../../domain/room.service';
import { RoomBroadcaster } from './room-broadcaster';
import { RoomTimers } from './room-timers';

@Injectable()
export class RoomChangeSubscriber implements OnModuleDestroy {
    private unsubscribe: (() => void) | undefined;

    constructor(
        private readonly rooms: RoomService,
        private readonly broadcaster: RoomBroadcaster,
        private readonly timers: RoomTimers,
    ) {}

    attach(server: Server): void {
        this.broadcaster.attach(server);
        this.unsubscribe ??= this.rooms.onChange(({ roomCode }) => {
            this.timers.sync(roomCode);
            this.broadcaster.broadcast(roomCode);
        });
    }

    onModuleDestroy(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }
}
