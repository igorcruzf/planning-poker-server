import { Injectable } from '@nestjs/common';
import { MAX_CONNECTIONS_PER_ADDRESS } from './limits';

@Injectable()
export class ConnectionLimiter {
    private readonly addressBySocket = new Map<string, string>();
    private readonly countByAddress = new Map<string, number>();

    isFull(address: string): boolean {
        return (this.countByAddress.get(address) ?? 0) >= MAX_CONNECTIONS_PER_ADDRESS;
    }

    add(socketId: string, address: string): void {
        if (this.addressBySocket.has(socketId)) return;
        this.addressBySocket.set(socketId, address);
        this.countByAddress.set(address, (this.countByAddress.get(address) ?? 0) + 1);
    }

    remove(socketId: string): void {
        const address = this.addressBySocket.get(socketId);
        if (address === undefined) return;
        this.addressBySocket.delete(socketId);
        const remaining = (this.countByAddress.get(address) ?? 1) - 1;
        if (remaining <= 0) this.countByAddress.delete(address);
        else this.countByAddress.set(address, remaining);
    }
}
