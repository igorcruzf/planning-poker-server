import { Body, Controller, Delete, Header, Headers, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import { z } from 'zod';
import {
    JIRA_API_PATHS,
    JIRA_AUTHORIZATION_HEADER,
    JiraAgendaResponse,
    JiraIssueResponse,
    JiraSaveSizeResponse,
    ROOM_SESSION_HEADER,
    jiraAgendaRequestSchema,
    jiraCurrentIssueRequestSchema,
    jiraRoomIssuePathParamsSchema,
    jiraRoomPathParamsSchema,
    jiraSaveSizeRequestSchema,
} from '../../contracts';
import { invalidPayloadFrom } from '../../gateway/session/invalid-payload';
import { JiraCallContext } from '../api/jira-call';
import { JiraAppException } from '../auth/jira-app.exception';
import type { HeaderTarget } from '../http/jira-http-session';
import { applyJiraSessionHeaders, openJiraCall } from '../http/jira-http-session';
import { JiraRoomService } from './jira-room.service';

const NO_STORE = 'no-store';

const parseOrReject = <Schema extends z.ZodType>(schema: Schema, input: unknown): z.infer<Schema> => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new JiraAppException(invalidPayloadFrom(parsed.error.issues));
    return parsed.data;
};

@Controller()
export class JiraRoomController {
    constructor(private readonly service: JiraRoomService) {}

    @Post(JIRA_API_PATHS.agenda)
    @Header('Cache-Control', NO_STORE)
    @HttpCode(200)
    async addToAgenda(
        @Param() params: unknown,
        @Headers(ROOM_SESSION_HEADER) sessionToken: string | undefined,
        @Headers(JIRA_AUTHORIZATION_HEADER) authorization: string | undefined,
        @Body() body: unknown,
        @Res({ passthrough: true }) response: HeaderTarget,
    ): Promise<JiraAgendaResponse> {
        const { roomCode } = parseOrReject(jiraRoomPathParamsSchema, params);
        this.service.requireLinkedFacilitator(roomCode, sessionToken);
        const request = parseOrReject(jiraAgendaRequestSchema, body);
        const agenda = await this.withJiraCall(authorization, response, (call) =>
            this.service.addToAgenda(roomCode, call, request),
        );
        return { agenda };
    }

    @Delete(JIRA_API_PATHS.agendaIssue)
    @Header('Cache-Control', NO_STORE)
    @HttpCode(204)
    removeFromAgenda(
        @Param() params: unknown,
        @Headers(ROOM_SESSION_HEADER) sessionToken: string | undefined,
    ): void {
        const { roomCode, issueKey } = parseOrReject(jiraRoomIssuePathParamsSchema, params);
        this.service.requireLinkedFacilitator(roomCode, sessionToken);
        this.service.removeFromAgenda(roomCode, issueKey);
    }

    @Put(JIRA_API_PATHS.currentIssue)
    @Header('Cache-Control', NO_STORE)
    async setCurrentIssue(
        @Param() params: unknown,
        @Headers(ROOM_SESSION_HEADER) sessionToken: string | undefined,
        @Headers(JIRA_AUTHORIZATION_HEADER) authorization: string | undefined,
        @Body() body: unknown,
        @Res({ passthrough: true }) response: HeaderTarget,
    ): Promise<JiraIssueResponse> {
        const { roomCode } = parseOrReject(jiraRoomPathParamsSchema, params);
        const actorId = this.service.requireLinkedFacilitator(roomCode, sessionToken);
        const { issueKey } = parseOrReject(jiraCurrentIssueRequestSchema, body);
        const issue = await this.withJiraCall(authorization, response, (call) =>
            this.service.setCurrentIssue(roomCode, actorId, call, issueKey),
        );
        return { issue };
    }

    @Put(JIRA_API_PATHS.issueSize)
    @Header('Cache-Control', NO_STORE)
    saveSize(
        @Param() params: unknown,
        @Headers(ROOM_SESSION_HEADER) sessionToken: string | undefined,
        @Headers(JIRA_AUTHORIZATION_HEADER) authorization: string | undefined,
        @Body() body: unknown,
        @Res({ passthrough: true }) response: HeaderTarget,
    ): Promise<JiraSaveSizeResponse> {
        const { roomCode, issueKey } = parseOrReject(jiraRoomIssuePathParamsSchema, params);
        this.service.requireLinkedFacilitator(roomCode, sessionToken);
        const { value } = parseOrReject(jiraSaveSizeRequestSchema, body);
        return this.withJiraCall(authorization, response, (call) =>
            this.service.saveSize(roomCode, call, issueKey, value),
        );
    }

    private async withJiraCall<Result>(
        authorization: string | undefined,
        response: HeaderTarget,
        action: (call: JiraCallContext) => Promise<Result>,
    ): Promise<Result> {
        const call = openJiraCall(authorization);
        try {
            return await action(call);
        } finally {
            applyJiraSessionHeaders(response, call);
        }
    }
}
