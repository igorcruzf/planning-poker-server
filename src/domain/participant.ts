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

export const isHuman = (participant: Participant): boolean => participant.role !== 'bot';

export const isPlayer = (participant: Participant): boolean => participant.role === 'player';

export const toParticipantView = ({ tokenHash: _tokenHash, ...view }: Participant): ParticipantView => view;

export const normalizeName = (name: string): string => name.normalize('NFC').trim().toLowerCase();

export const isReservedForKiro = (name: string): boolean => {
    const reserved = normalizeName(KIRO_SEAT_NAME_PREFIX);
    const wanted = normalizeName(name);
    return wanted === reserved || wanted.startsWith(`${reserved} `);
};
