import { z } from 'zod';
import { appErrorSchema } from './errors';

export const ackFailureSchema = z.object({ ok: z.literal(false), error: appErrorSchema });
export type AckFailure = z.infer<typeof ackFailureSchema>;

export const ackSchema = <T extends z.ZodType>(dataSchema: T) =>
    z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), data: dataSchema }), ackFailureSchema]);

export type AckSuccess<T> = { ok: true; data: T };
export type Ack<T> = AckSuccess<T> | AckFailure;
export type AckCallback<T> = (ack: Ack<T>) => void;
