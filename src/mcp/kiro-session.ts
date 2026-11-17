import { domainErrors } from '../domain/domain-error';
export interface KiroSeatBinding {
    readonly roomCode: string;
    readonly participantId: string;
}
export interface RoundMarker {
    readonly roundId: number;
    readonly issueKey: string | null;
}
export class KiroSession {
    private binding: KiroSeatBinding | null = null;
    private lastSeen: RoundMarker | null = null;
    private closed = false;
    private waiting = false;
    private readonly closeHandlers = new Set<() => void>();
    get seat(): KiroSeatBinding | null {
        return this.binding;
    }
    get isClosed(): boolean {
        return this.closed;
    }
    get isWaiting(): boolean {
        return this.waiting;
    }
    get seen(): RoundMarker | null {
        return this.lastSeen;
    }
    requireSeat(): KiroSeatBinding {
        if (this.closed || !this.binding) throw domainErrors.forbidden('not_in_room');
        return this.binding;
    }
    sit(binding: KiroSeatBinding, marker: RoundMarker): void {
        this.binding = binding;
        this.lastSeen = marker;
    }
    markSeen(marker: RoundMarker): void {
        this.lastSeen = marker;
    }
    beginWait(): void {
        this.waiting = true;
    }
    endWait(): void {
        this.waiting = false;
    }
    onClose(handler: () => void): () => void {
        this.closeHandlers.add(handler);
        return () => {
            this.closeHandlers.delete(handler);
        };
    }
    close(): void {
        if (this.closed) return;
        this.closed = true;
        const handlers = [...this.closeHandlers];
        this.closeHandlers.clear();
        handlers.forEach((handler) => handler());
    }
}
