import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import {
    Ack,
    AckFailure,
    AppError,
    CLIENT_EVENTS,
    ClientEventName,
    ClientEventResult,
    ParsedClientEventPayload,
} from '../../contracts';
import { DomainError } from '../../domain/domain-error';
import { clientAddressOf } from './client-address';
import { EventRateLimiter } from './event-rate-limiter';
import { invalidPayloadFrom } from './invalid-payload';

const failure = (error: AppError): AckFailure => ({ ok: false, error });

@Injectable()
export class ClientEventRunner {
    constructor(private readonly limiter: EventRateLimiter) {}

    run<E extends ClientEventName>(
        event: E,
        payload: unknown,
        socket: Pick<Socket, 'id' | 'handshake'>,
        action: (input: ParsedClientEventPayload<E>) => ClientEventResult<E>,
    ): Ack<ClientEventResult<E>> {
        const retryAfterMs = this.limiter.check(event, socket.id, clientAddressOf(socket));
        if (retryAfterMs !== null) return failure({ code: 'rate_limited', retryAfterMs });
        const parsed = CLIENT_EVENTS[event].payload.safeParse(payload);
        if (!parsed.success) return failure(invalidPayloadFrom(parsed.error.issues));
        try {
            return { ok: true, data: action(parsed.data as ParsedClientEventPayload<E>) };
        } catch (error) {
            if (error instanceof DomainError) return failure(error.error);
            throw error;
        }
    }
}
