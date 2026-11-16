import { ParticipantRole, Presence } from '../contracts';

export interface Participant {
    readonly id: string;
    readonly ownerId: string | null;
    readonly tokenHash: string | null;
    name: string;
    role: ParticipantRole;
    presence: Presence;
    disconnectedAt: number | null;
    vote: string | null;
    rationale: string | null;
    umbrella: boolean;
}

export const isHuman = (participant: Participant): boolean => participant.role !== 'bot';

export const isPlayer = (participant: Participant): boolean => participant.role === 'player';

export const normalizeName = (name: string): string => name.trim().toLocaleLowerCase();
