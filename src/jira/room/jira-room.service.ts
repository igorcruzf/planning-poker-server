import { Injectable } from '@nestjs/common';
import {
    JIRA_AGENDA_MAX_ISSUES,
    JiraAgendaRequest,
    JiraIssue,
    JiraIssueSummary,
    JiraRoomState,
    JiraSaveSizeResponse,
    jiraIssueSummarySchema,
} from '../../contracts';
import { DomainError } from '../../domain/domain-error';
import { findDeckCard } from '../../domain/deck-rules';
import { isPlayer } from '../../domain/participant';
import { Room } from '../../domain/room';
import { RoomService } from '../../domain/room.service';
import { JiraCallContext } from '../api/jira-call';
import { JiraResultComment } from '../api/jira-comment';
import { JiraAppException } from '../auth/jira-app.exception';
import { JiraIssuesService } from '../http/jira-issues.service';

const EMPTY_JIRA_STATE: JiraRoomState = { connected: false, agenda: [], currentIssue: null };
const PERCENT = 100;

const summaryOf = (issue: JiraIssue): JiraIssueSummary => jiraIssueSummarySchema.parse(issue);

const notInDeck = () =>
    new JiraAppException({ code: 'invalid_payload', issues: [{ path: 'value', message: 'invalid_value' }] });

const mergeAgenda = (current: JiraIssueSummary[], resolved: JiraIssueSummary[]): JiraIssueSummary[] => {
    const refreshed = current.map((item) => resolved.find(({ key }) => key === item.key) ?? item);
    const added = resolved.filter(({ key }) => !current.some((item) => item.key === key));
    return [...refreshed, ...added].slice(0, JIRA_AGENDA_MAX_ISSUES);
};

@Injectable()
export class JiraRoomService {
    constructor(
        private readonly rooms: RoomService,
        private readonly issues: JiraIssuesService,
    ) {}

    requireLinkedFacilitator(roomCode: string, sessionToken: string | undefined): string {
        return this.translateDomainErrors(() => {
            const actor = this.rooms.authenticate(roomCode, sessionToken ?? '');
            const room = this.rooms.getRoom(roomCode);
            if (room.facilitatorId !== actor.id) {
                throw new JiraAppException({ code: 'forbidden', reason: 'facilitator_only' });
            }
            if (!room.settings.jiraLinked) throw new JiraAppException({ code: 'jira_room_not_linked' });
            return actor.id;
        });
    }

    async addToAgenda(roomCode: string, call: JiraCallContext, request: JiraAgendaRequest): Promise<JiraIssueSummary[]> {
        const resolved = await this.withJira(roomCode, () => this.issues.resolveAgenda(call, request));
        const agenda = mergeAgenda(this.jiraStateOf(roomCode).agenda, resolved);
        this.publish(roomCode, (state) => ({ ...state, connected: true, agenda }));
        return agenda;
    }

    removeFromAgenda(roomCode: string, issueKey: string): void {
        const state = this.rooms.getRoom(roomCode).jira;
        if (!state?.agenda.some(({ key }) => key === issueKey)) return;
        this.publish(roomCode, ({ agenda, ...rest }) => ({ ...rest, agenda: agenda.filter(({ key }) => key !== issueKey) }));
    }

    async setCurrentIssue(roomCode: string, actorId: string, call: JiraCallContext, issueKey: string): Promise<JiraIssue> {
        const issue = await this.withJira(roomCode, () => this.issues.getIssue(call, issueKey));
        this.publish(roomCode, (state) => ({ ...state, connected: true, currentIssue: issue }));
        this.translateDomainErrors(() =>
            this.rooms.setCurrentIssue(roomCode, actorId, { key: issue.key, summary: issue.summary }),
        );
        return issue;
    }

    async saveSize(
        roomCode: string,
        call: JiraCallContext,
        issueKey: string,
        value: string,
    ): Promise<JiraSaveSizeResponse> {
        const room = this.rooms.getRoom(roomCode);
        const card = findDeckCard(room.settings, value);
        if (!card) throw notInDeck();
        const comment = room.settings.jiraCommentOnSave ? this.resultComment(room, value, card.meaning) : undefined;
        const saved = await this.withJira(roomCode, () => this.issues.saveSize(call, issueKey, value, comment));
        this.publish(roomCode, (state) => ({
            connected: true,
            agenda: state.agenda.map((item) => (item.key === issueKey ? summaryOf(saved.issue) : item)),
            currentIssue: state.currentIssue?.key === issueKey ? saved.issue : state.currentIssue,
        }));
        return saved;
    }

    private resultComment(room: Room, size: string, meaning?: string): JiraResultComment | undefined {
        const ballots = room.ballots;
        const playerBallots = ballots.filter(isPlayer);
        if (playerBallots.length === 0) return undefined;
        const counts = new Map<string, number>();
        playerBallots.forEach(({ value }) => counts.set(value, (counts.get(value) ?? 0) + 1));
        const kiroGuess = ballots.find(({ role }) => role === 'bot')?.value;
        return {
            size,
            meaning,
            votes: [...counts].map(([value, count]) => ({ value, count })),
            consensusPercent: Math.round(((counts.get(size) ?? 0) / playerBallots.length) * PERCENT),
            kiroGuess,
        };
    }

    private jiraStateOf(roomCode: string): JiraRoomState {
        return this.rooms.getRoom(roomCode).jira ?? EMPTY_JIRA_STATE;
    }

    private publish(roomCode: string, change: (state: JiraRoomState) => JiraRoomState): void {
        this.rooms.setJiraState(roomCode, change(this.jiraStateOf(roomCode)));
    }

    private async withJira<Result>(roomCode: string, action: () => Promise<Result>): Promise<Result> {
        try {
            return await action();
        } catch (error) {
            if (error instanceof JiraAppException && error.code === 'jira_reconnect_required') {
                this.markDisconnected(roomCode);
            }
            throw error;
        }
    }

    private markDisconnected(roomCode: string): void {
        if (!this.jiraStateOf(roomCode).connected) return;
        this.publish(roomCode, (state) => ({ ...state, connected: false }));
    }

    private translateDomainErrors<Result>(action: () => Result): Result {
        try {
            return action();
        } catch (error) {
            throw error instanceof DomainError ? new JiraAppException(error.error) : error;
        }
    }
}
