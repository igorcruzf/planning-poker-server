import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
    JIRA_AGENDA_MAX_ISSUES,
    JIRA_SIZE_FIELD_NAME,
    JiraIssue,
    JiraIssueSummary,
    JiraSizeField,
    SPECIAL_CARDS,
    jiraIssueKeySchema,
} from '../../contracts';
import { JiraAppException, jiraError } from '../auth/jira-app.exception';
import { toAdfDocument } from './jira-comment';
import { JiraCallContext } from './jira-call';
import {
    editmetaSchema,
    fieldListSchema,
    issueResponseSchema,
    searchResponseSchema,
    sizeFieldFromEditmeta,
    toIssue,
    toIssueSummary,
} from './jira-issue.mapper';
import { JiraTransport } from './jira-transport';

const SEARCH_FIELDS = ['summary', 'issuetype', 'status'];
const NO_SIZE_FIELD_ID = null;

const invalidJql = () =>
    new JiraAppException({ code: 'invalid_payload', issues: [{ path: 'jql', message: 'JQL inválida' }] });

const assertIssueKey = (key: string): string => {
    const parsed = jiraIssueKeySchema.safeParse(key);
    if (!parsed.success) {
        throw new JiraAppException({ code: 'invalid_payload', issues: [{ path: 'issueKey', message: 'Chave inválida' }] });
    }
    return parsed.data;
};

const parseOrUnavailable = <Schema extends z.ZodType>(schema: Schema, body: unknown): z.infer<Schema> => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        throw jiraError('jira_unavailable');
    }
    return parsed.data;
};

@Injectable()
export class JiraApiClient {
    private readonly sizeFieldIds = new Map<string, string | null>();

    constructor(private readonly transport: JiraTransport) {}

    searchByKeys(call: JiraCallContext, keys: string[]): Promise<JiraIssueSummary[]> {
        const validKeys = keys.map(assertIssueKey);
        return this.search(call, `key in (${validKeys.join(',')})`, () => jiraError('jira_issue_not_found')).then(
            (found) =>
                validKeys.flatMap((key) => {
                    const match = found.find((summary) => summary.key === key);
                    return match ? [match] : [];
                }),
        );
    }

    searchByJql(call: JiraCallContext, jql: string): Promise<JiraIssueSummary[]> {
        return this.search(call, jql, invalidJql);
    }

    async getIssue(call: JiraCallContext, key: string): Promise<JiraIssue> {
        const body = await this.transport.send(call, {
            method: 'GET',
            path: `/rest/api/3/issue/${assertIssueKey(key)}`,
            query: { expand: 'renderedFields,editmeta', fields: '*all' },
            onBadRequest: () => jiraError('jira_issue_not_found'),
        });
        const { siteUrl } = await this.transport.siteOf(call);
        return toIssue(parseOrUnavailable(issueResponseSchema, body), siteUrl);
    }

    async discoverSizeField(call: JiraCallContext, key: string): Promise<JiraSizeField | null> {
        const body = await this.transport.send(call, {
            method: 'GET',
            path: `/rest/api/3/issue/${assertIssueKey(key)}/editmeta`,
            onBadRequest: () => jiraError('jira_size_unavailable'),
        });
        return sizeFieldFromEditmeta(parseOrUnavailable(editmetaSchema, body));
    }

    async saveSize(call: JiraCallContext, key: string, value: string): Promise<void> {
        const issueKey = assertIssueKey(key);
        if ((SPECIAL_CARDS as readonly string[]).includes(value)) {
            throw jiraError('jira_size_option_missing');
        }
        const sizeField = await this.discoverSizeField(call, issueKey);
        if (!sizeField) {
            throw jiraError('jira_size_unavailable');
        }
        const option = sizeField.options.find((candidate) => candidate.value === value);
        if (!option) {
            throw jiraError('jira_size_option_missing');
        }
        await this.transport.send(call, {
            method: 'PUT',
            path: `/rest/api/3/issue/${issueKey}`,
            body: { fields: { [sizeField.fieldId]: { id: option.id } } },
            onBadRequest: () => jiraError('jira_size_unavailable'),
        });
    }

    async addComment(call: JiraCallContext, key: string, text: string): Promise<void> {
        await this.transport.send(call, {
            method: 'POST',
            path: `/rest/api/3/issue/${assertIssueKey(key)}/comment`,
            body: { body: toAdfDocument(text) },
            onBadRequest: () => jiraError('jira_unavailable'),
        });
    }

    private async search(
        call: JiraCallContext,
        jql: string,
        onBadRequest: () => JiraAppException,
    ): Promise<JiraIssueSummary[]> {
        const sizeFieldId = await this.sizeFieldIdOf(call);
        const body = await this.transport.send(call, {
            method: 'GET',
            path: '/rest/api/3/search/jql',
            query: {
                jql,
                maxResults: String(JIRA_AGENDA_MAX_ISSUES),
                fields: (sizeFieldId ? [...SEARCH_FIELDS, sizeFieldId] : SEARCH_FIELDS).join(','),
            },
            onBadRequest,
        });
        const { siteUrl } = await this.transport.siteOf(call);
        return parseOrUnavailable(searchResponseSchema, body)
            .issues.slice(0, JIRA_AGENDA_MAX_ISSUES)
            .map((raw) => toIssueSummary(raw, siteUrl, sizeFieldId));
    }

    private async sizeFieldIdOf(call: JiraCallContext): Promise<string | null> {
        const { cloudId } = await this.transport.siteOf(call);
        if (this.sizeFieldIds.has(cloudId)) {
            return this.sizeFieldIds.get(cloudId) ?? NO_SIZE_FIELD_ID;
        }
        const body = await this.transport.send(call, {
            method: 'GET',
            path: '/rest/api/3/field',
            onBadRequest: () => jiraError('jira_unavailable'),
        });
        const field = parseOrUnavailable(fieldListSchema, body).find(({ name }) => name === JIRA_SIZE_FIELD_NAME);
        this.sizeFieldIds.set(cloudId, field?.id ?? NO_SIZE_FIELD_ID);
        return field?.id ?? NO_SIZE_FIELD_ID;
    }
}
