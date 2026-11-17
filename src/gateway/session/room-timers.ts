import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Clock } from '../../domain/clock';
import { Room } from '../../domain/room';
import { RoomService } from '../../domain/room.service';
import { describeError } from '../describe-error';
import { CancelTimer, Scheduler } from './scheduler';

interface PresenceTimer {
    deadline: number;
    cancel: CancelTimer;
}

interface CountdownTimer {
    roundId: number;
    cancel: CancelTimer;
}

interface RoomTimerSlots {
    presence?: PresenceTimer;
    countdown?: CountdownTimer;
}

@Injectable()
export class RoomTimers implements OnModuleDestroy {
    private readonly logger = new Logger(RoomTimers.name);
    private readonly slots = new Map<string, RoomTimerSlots>();

    constructor(
        private readonly rooms: RoomService,
        private readonly scheduler: Scheduler,
        private readonly clock: Clock,
    ) {}

    sync(roomCode: string): void {
        const room = this.findRoom(roomCode);
        if (!room) {
            this.cancel(roomCode);
            return;
        }
        const slots = this.slotsOf(roomCode);
        this.syncPresence(room, slots);
        this.syncCountdown(room, slots);
        if (!slots.presence && !slots.countdown) this.slots.delete(roomCode);
    }

    cancel(roomCode: string): void {
        const slots = this.slots.get(roomCode);
        slots?.presence?.cancel();
        slots?.countdown?.cancel();
        this.slots.delete(roomCode);
    }

    onModuleDestroy(): void {
        [...this.slots.keys()].forEach((roomCode) => this.cancel(roomCode));
    }

    private syncPresence(room: Room, slots: RoomTimerSlots): void {
        const deadline = room.nextPresenceDeadline();
        if (slots.presence?.deadline === deadline) return;
        slots.presence?.cancel();
        slots.presence = undefined;
        if (deadline === null) return;
        const cancel = this.scheduler.after(Math.max(0, deadline - this.clock.now()), () =>
            this.run(room.code, () => {
                this.slotsOf(room.code).presence = undefined;
                this.rooms.settle(room.code);
            }),
        );
        slots.presence = { deadline, cancel };
    }

    private syncCountdown(room: Room, slots: RoomTimerSlots): void {
        const countdown = room.phase === 'countdown' ? room.countdown : null;
        if (slots.countdown && slots.countdown.roundId === room.roundId && countdown) return;
        slots.countdown?.cancel();
        slots.countdown = undefined;
        if (!countdown) return;
        const roundId = room.roundId;
        const cancel = this.scheduler.after(countdown.countdownMs, () =>
            this.run(room.code, () => {
                this.slotsOf(room.code).countdown = undefined;
                this.rooms.finishCountdown(room.code, roundId);
            }),
        );
        slots.countdown = { roundId, cancel };
    }

    private run(roomCode: string, action: () => void): void {
        try {
            action();
        } catch (error) {
            this.logger.error(`Timer of room ${roomCode} failed: ${describeError(error)}`);
        }
        this.sync(roomCode);
    }

    private slotsOf(roomCode: string): RoomTimerSlots {
        const slots = this.slots.get(roomCode) ?? {};
        this.slots.set(roomCode, slots);
        return slots;
    }

    private findRoom(roomCode: string): Room | undefined {
        try {
            return this.rooms.getRoom(roomCode);
        } catch {
            return undefined;
        }
    }
}
