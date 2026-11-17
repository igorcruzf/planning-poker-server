import { Injectable } from '@nestjs/common';
import { Clock } from '../../domain/clock';
import { ADDRESS_ENTRY_LIMIT, ADDRESS_EVENT_LIMIT, ENTRY_EVENTS, SOCKET_EVENT_LIMIT } from './limits';
import { RateLimiter } from './rate-limiter';

@Injectable()
export class EventRateLimiter {
    private readonly perSocket: RateLimiter;
    private readonly perAddress: RateLimiter;
    private readonly entriesPerAddress: RateLimiter;

    constructor(clock: Clock) {
        this.perSocket = new RateLimiter(SOCKET_EVENT_LIMIT, clock);
        this.perAddress = new RateLimiter(ADDRESS_EVENT_LIMIT, clock);
        this.entriesPerAddress = new RateLimiter(ADDRESS_ENTRY_LIMIT, clock);
    }

    check(event: string, socketId: string, address: string): number | null {
        const waits = [this.perSocket.consume(socketId), this.perAddress.consume(address)];
        if (ENTRY_EVENTS.has(event)) waits.push(this.entriesPerAddress.consume(address));
        const blocked = waits.filter((wait): wait is number => wait !== null);
        return blocked.length > 0 ? Math.max(...blocked) : null;
    }

    release(socketId: string): void {
        this.perSocket.release(socketId);
    }
}
