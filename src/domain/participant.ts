import { KIRO_SEAT_NAME_PREFIX, ParticipantRole, Presence } from '../contracts';

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

export type ParticipantView = Readonly<Omit<Participant, 'tokenHash'>>;

export const isHuman = (participant: Pick<Participant, 'role'>): boolean => participant.role !== 'bot';

export const isPlayer = (participant: Pick<Participant, 'role'>): boolean => participant.role === 'player';

export const toParticipantView = (participant: Participant): ParticipantView => ({
    id: participant.id,
    ownerId: participant.ownerId,
    name: participant.name,
    role: participant.role,
    presence: participant.presence,
    disconnectedAt: participant.disconnectedAt,
    vote: participant.vote,
    rationale: participant.rationale,
    umbrella: participant.umbrella,
});

export const normalizeName = (name: string): string => name.normalize('NFC').trim().toLowerCase();

export const isReservedForKiro = (name: string): boolean => {
    const reserved = normalizeName(KIRO_SEAT_NAME_PREFIX);
    const wanted = normalizeName(name);
    return wanted === reserved || wanted.startsWith(`${reserved} `);
};
