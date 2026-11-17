import { Injectable } from '@nestjs/common';
import {
    JiraAgendaRequest,
    JiraIssue,
    JiraIssueSummary,
    JiraSaveSizeResponse,
    jiraAgendaRequestSchema,
} from '../../contracts';
import { JiraApiClient } from '../api/jira-api.client';
import { JiraCallContext } from '../api/jira-call';
import { JiraResultComment, buildResultComment } from '../api/jira-comment';
import { JiraAppException } from '../auth/jira-app.exception';

@Injectable()
export class JiraIssuesService {
    constructor(private readonly client: JiraApiClient) {}

    async resolveAgenda(call: JiraCallContext, request: JiraAgendaRequest): Promise<JiraIssueSummary[]> {
        const parsed = jiraAgendaRequestSchema.safeParse(request);
        if (!parsed.success) {
            throw new JiraAppException({
                code: 'invalid_payload',
                issues: [{ path: 'agenda', message: 'Pedido de pauta inválido' }],
            });
        }
        return parsed.data.type === 'keys'
            ? this.client.searchByKeys(call, parsed.data.keys)
            : this.client.searchByJql(call, parsed.data.jql);
    }

    getIssue(call: JiraCallContext, key: string): Promise<JiraIssue> {
        return this.client.getIssue(call, key);
    }

    async saveSize(
        call: JiraCallContext,
        key: string,
        value: string,
        comment?: JiraResultComment,
    ): Promise<JiraSaveSizeResponse> {
        await this.client.saveSize(call, key, value);
        const commentPosted = comment ? await this.tryComment(call, key, comment) : false;
        return { issue: await this.client.getIssue(call, key), commentPosted };
    }

    private async tryComment(call: JiraCallContext, key: string, comment: JiraResultComment): Promise<boolean> {
        try {
            await this.client.addComment(call, key, buildResultComment(comment));
            return true;
        } catch (error) {
            if (error instanceof JiraAppException) {
                return false;
            }
            throw error;
        }
    }
}
