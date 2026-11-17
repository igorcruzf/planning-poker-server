import { JiraAgendaRequest, JiraIssue, JiraIssueSummary, jiraSaveSizeResponseSchema } from '../../contracts';
import { JiraApiClient } from '../api/jira-api.client';
import { createJiraCall } from '../api/jira-call';
import { JiraResultComment } from '../api/jira-comment';
import { JiraAppException, jiraError } from '../auth/jira-app.exception';
import { JiraIssuesService } from './jira-issues.service';

const summary = (key: string): JiraIssueSummary => ({
    key,
    summary: `Resumo ${key}`,
    issueType: 'Story',
    status: 'To Do',
    size: null,
    url: `https://acme.atlassian.net/browse/${key}`,
});

const issue = (key: string, size: string | null = null): JiraIssue => ({
    ...summary(key),
    size,
    assignee: null,
    descriptionHtml: null,
    sizeField: { fieldId: 'customfield_10191', options: [{ id: '2', value: 'M' }] },
});

const result: JiraResultComment = {
    size: 'M',
    meaning: 'até 10 dias',
    votes: [{ value: 'M', count: 2 }],
    consensusPercent: 100,
};

describe('JiraIssuesService', () => {
    const call = createJiraCall('blob-1');
    let client: {
        searchByKeys: jest.Mock;
        searchByJql: jest.Mock;
        getIssue: jest.Mock;
        saveSize: jest.Mock;
        addComment: jest.Mock;
    };
    let service: JiraIssuesService;

    beforeEach(() => {
        client = {
            searchByKeys: jest.fn(async (_call, keys: string[]) => keys.map(summary)),
            searchByJql: jest.fn(async () => [summary('YAK-3')]),
            getIssue: jest.fn(async (_call, key: string) => issue(key)),
            saveSize: jest.fn(async () => undefined),
            addComment: jest.fn(async () => undefined),
        };
        service = new JiraIssuesService(client as unknown as JiraApiClient);
    });

    describe('resolveAgenda', () => {
        it('searches by keys', async () => {
            const request: JiraAgendaRequest = { type: 'keys', keys: ['YAK-1', 'YAK-2'] };

            const agenda = await service.resolveAgenda(call, request);

            expect(client.searchByKeys).toHaveBeenCalledWith(call, ['YAK-1', 'YAK-2']);
            expect(agenda.map(({ key }) => key)).toEqual(['YAK-1', 'YAK-2']);
        });

        it('searches by JQL', async () => {
            const agenda = await service.resolveAgenda(call, { type: 'jql', jql: 'project = YAK' });

            expect(client.searchByJql).toHaveBeenCalledWith(call, 'project = YAK');
            expect(agenda).toEqual([summary('YAK-3')]);
        });

        it('rejects a request that does not match the agenda schema before calling Atlassian', async () => {
            const invalid = { type: 'keys', keys: [] } as unknown as JiraAgendaRequest;

            await expect(service.resolveAgenda(call, invalid)).rejects.toBeInstanceOf(JiraAppException);
            expect(client.searchByKeys).not.toHaveBeenCalled();
        });
    });

    describe('getIssue', () => {
        it('returns the card', async () => {
            expect(await service.getIssue(call, 'YAK-1')).toEqual(issue('YAK-1'));
        });
    });

    describe('saveSize', () => {
        it('saves the size and returns the refreshed card without a comment by default', async () => {
            client.getIssue.mockResolvedValue(issue('YAK-1', 'M'));

            const response = await service.saveSize(call, 'YAK-1', 'M');

            expect(response).toEqual({ issue: issue('YAK-1', 'M'), commentPosted: false });
            expect(jiraSaveSizeResponseSchema.safeParse(response).success).toBe(true);
            expect(client.saveSize).toHaveBeenCalledWith(call, 'YAK-1', 'M');
            expect(client.addComment).not.toHaveBeenCalled();
        });

        it('posts the E1 comment when the room asks for it', async () => {
            const response = await service.saveSize(call, 'YAK-1', 'M', result);

            expect(response.commentPosted).toBe(true);
            expect(client.addComment).toHaveBeenCalledWith(
                call,
                'YAK-1',
                'YakPoker · Size definido: M (até 10 dias) · Votos: M ×2 · Consenso 100%',
            );
        });

        it('keeps the saved size and reports commentPosted false when the comment fails', async () => {
            client.addComment.mockRejectedValue(jiraError('jira_forbidden'));

            const response = await service.saveSize(call, 'YAK-1', 'M', result);

            expect(response.commentPosted).toBe(false);
            expect(response.issue.key).toBe('YAK-1');
        });

        it('does not comment nor reread the card when saving the size fails', async () => {
            client.saveSize.mockRejectedValue(jiraError('jira_size_option_missing'));

            await expect(service.saveSize(call, 'YAK-1', 'GG', result)).rejects.toMatchObject({
                error: { code: 'jira_size_option_missing' },
            });
            expect(client.addComment).not.toHaveBeenCalled();
            expect(client.getIssue).not.toHaveBeenCalled();
        });

        it.each(['?', 'yakult'])('never saves the special card %p', async (value) => {
            client.saveSize.mockRejectedValue(jiraError('jira_size_option_missing'));

            await expect(service.saveSize(call, 'YAK-1', value, result)).rejects.toMatchObject({
                error: { code: 'jira_size_option_missing' },
            });
            expect(client.addComment).not.toHaveBeenCalled();
        });
    });
});
