import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { roomCodeSchema, RoomCreatePayload } from '../contracts';
import { Clock } from './clock';
import { domainErrors } from './domain-error';
import { RoomCodeGenerator } from './room-code';
import { Room } from './room';

export const SERVER_INSTANCE_ID = 'SERVER_INSTANCE_ID';
export const SWEEP_INTERVAL_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 20;

@Injectable()
export class RoomRepository implements OnModuleInit, OnModuleDestroy {
    private readonly rooms = new Map<string, Room>();
    private sweeper: NodeJS.Timeout | null = null;

    constructor(
        @Inject(Clock) private readonly clock: Clock,
        @Inject(RoomCodeGenerator) private readonly codes: RoomCodeGenerator,
        @Inject(SERVER_INSTANCE_ID) readonly serverInstanceId: string,
    ) {}

    get size(): number {
        return this.rooms.size;
    }

    create(payload: RoomCreatePayload): Room {
        const room = new Room(
            { clock: this.clock, serverInstanceId: this.serverInstanceId },
            this.uniqueCode(),
            payload,
        );
        this.rooms.set(room.code, room);
        return room;
    }

    find(code: string): Room | undefined {
        const normalized = roomCodeSchema.safeParse(code);
        const room = normalized.success ? this.rooms.get(normalized.data) : undefined;
        if (room?.isExpired(this.clock.now())) {
            this.rooms.delete(room.code);
            return undefined;
        }
        return room;
    }

    discard(code: string): void {
        this.rooms.delete(code);
    }

    require(code: string): Room {
        const room = this.find(code);
        if (!room) throw domainErrors.roomNotFound(this.serverInstanceId);
        return room;
    }

    findByKiroInvite(inviteCode: string): Room | undefined {
        const now = this.clock.now();
        return [...this.rooms.values()].find((room) => !room.isExpired(now) && room.hasKiroInvite(inviteCode));
    }

    sweep(now: number): void {
        for (const [code, room] of this.rooms) {
            if (room.isExpired(now)) this.rooms.delete(code);
        }
    }

    onModuleInit(): void {
        if (this.sweeper) return;
        this.sweeper = setInterval(() => this.sweep(this.clock.now()), SWEEP_INTERVAL_MS);
        this.sweeper.unref();
    }

    onModuleDestroy(): void {
        if (this.sweeper) clearInterval(this.sweeper);
        this.sweeper = null;
    }

    private uniqueCode(): string {
        for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
            const code = this.codes.generate();
            if (!this.rooms.has(code)) return code;
        }
        throw domainErrors.internal();
    }
}
