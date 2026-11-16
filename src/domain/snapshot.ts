import { ParticipantState, RoomState, RoundState } from '../contracts';
import { isHuman, isPlayer, ParticipantView } from './participant';
import { Room } from './room';

export const ANONYMOUS_VIEWER_ID = 'anonymous';

export const snapshotFor = (room: Room, viewerId: string | null): RoomState => {
    const viewer = viewerId === null ? undefined : room.findParticipant(viewerId);
    return structuredClone({
        serverInstanceId: room.serverInstanceId,
        room: { code: room.code, name: room.name, createdAt: room.createdAt },
        settings: room.settings,
        participants: room.participants.map((participant) => participantState(room, participant)),
        round: roundState(room),
        history: [...room.history],
        jira: room.jira,
        self: { participantId: viewer?.id ?? ANONYMOUS_VIEWER_ID, vote: viewer?.vote ?? null },
    });
};

const participantState = (room: Room, participant: ParticipantView): ParticipantState => {
    const common = {
        id: participant.id,
        name: participant.name,
        isFacilitator: participant.id === room.facilitatorId,
        presence: participant.presence,
        hasVoted: participant.vote !== null,
        umbrella: participant.umbrella,
    };
    if (isHuman(participant)) return { ...common, role: participant.role as 'player' | 'spectator' };
    return { ...common, role: 'bot', ownerId: participant.ownerId! };
};

const roundState = (room: Room): RoundState => {
    const base = { id: room.roundId, issueKey: room.currentIssue?.key ?? null };
    if (room.phase === 'revealed') return revealedRoundState(room, base);
    const voting = { ...base, pendingVoterIds: room.pendingVoterIds() };
    if (room.phase === 'countdown' && room.countdown) return { ...voting, phase: 'countdown', ...room.countdown };
    return { ...voting, phase: 'voting' };
};

const revealedRoundState = (room: Room, base: { id: number; issueKey: string | null }): RoundState => {
    const { ballots } = room;
    return {
        ...base,
        phase: 'revealed',
        revealedAt: room.revealedAt ?? room.createdAt,
        votes: ballots
            .filter(isPlayer)
            .map((ballot) => ({ participantId: ballot.participantId, name: ballot.name, value: ballot.value })),
        kiroGuesses: ballots
            .filter((ballot) => ballot.role === 'bot')
            .map((ballot) => ({
                participantId: ballot.participantId,
                name: ballot.name,
                value: ballot.value,
                rationale: ballot.rationale ?? '',
            })),
        finalEstimate: room.finalEstimate?.value ?? null,
    };
};
