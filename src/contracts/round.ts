import { z } from 'zod';

export const roundPhaseSchema = z.enum(['voting', 'countdown', 'revealed']);
export type RoundPhase = z.infer<typeof roundPhaseSchema>;
