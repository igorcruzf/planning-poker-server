import { z } from 'zod';
import { participantIdSchema, timestampSchema } from './primitives';

export const FUN_THROWS_PER_WINDOW = 3;
export const FUN_THROW_WINDOW_MS = 5 * 1000;
export const FUN_SEED_MAX = 0xffffffff;

export const funThrowPayloadSchema = z.strictObject({ targetId: participantIdSchema });
export type FunThrowPayload = z.infer<typeof funThrowPayloadSchema>;

export const funUmbrellaPayloadSchema = z.strictObject({ enabled: z.boolean() });
export type FunUmbrellaPayload = z.infer<typeof funUmbrellaPayloadSchema>;

export const funThrownSchema = z.object({
    id: z.string().min(1),
    seed: z.number().int().min(0).max(FUN_SEED_MAX),
    fromId: participantIdSchema,
    targetId: participantIdSchema,
    blockedByUmbrella: z.boolean(),
    thrownAt: timestampSchema,
});
export type FunThrown = z.infer<typeof funThrownSchema>;
