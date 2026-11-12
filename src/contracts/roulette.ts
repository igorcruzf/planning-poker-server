import { z } from 'zod';
import { hasUniqueItems, PERSON_NAME_MAX_LENGTH, personNameSchema } from './primitives';

export const ROULETTE_MAX_NAMES = 50;
export const ROULETTE_NAME_MAX_LENGTH = PERSON_NAME_MAX_LENGTH;

export const rouletteModeSchema = z.enum(['leader', 'speaking_order']);
export type RouletteMode = z.infer<typeof rouletteModeSchema>;

const rouletteNamesSchema = z.array(personNameSchema).max(ROULETTE_MAX_NAMES);

const isUniqueSubsetOf = (subset: readonly string[], names: readonly string[]) =>
    hasUniqueItems(subset) && subset.every((name) => names.includes(name));

export const rouletteSpinPayloadSchema = z
    .strictObject({
        mode: rouletteModeSchema,
        names: rouletteNamesSchema.min(1),
        absent: rouletteNamesSchema.default([]),
        alreadyDrawn: rouletteNamesSchema.default([]),
    })
    .refine(({ names }) => hasUniqueItems(names), { message: 'Names must be unique', path: ['names'] })
    .refine(({ names, absent }) => isUniqueSubsetOf(absent, names), {
        message: 'Absent names must come from the list',
        path: ['absent'],
    })
    .refine(({ names, alreadyDrawn }) => isUniqueSubsetOf(alreadyDrawn, names), {
        message: 'Drawn names must come from the list',
        path: ['alreadyDrawn'],
    })
    .refine(({ names, absent }) => names.some((name) => !absent.includes(name)), {
        message: 'Someone must be present',
        path: ['absent'],
    });
export type RouletteSpinPayload = z.infer<typeof rouletteSpinPayloadSchema>;

export const rouletteSpunSchema = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('leader'), winner: z.string(), cycleRestarted: z.boolean() }),
    z.object({ mode: z.literal('speaking_order'), order: z.array(z.string()) }),
]);
export type RouletteSpun = z.infer<typeof rouletteSpunSchema>;
