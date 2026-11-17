import { JIRA_SESSION_HEADER } from '../../contracts';
import { JiraCallContext, createJiraCall } from '../api/jira-call';
import { jiraError } from '../auth/jira-app.exception';
import { parseBearerBlob } from '../auth/jira-session.service';

export interface HeaderTarget {
    setHeader(name: string, value: string): unknown;
}

export const openJiraCall = (authorization: string | undefined): JiraCallContext => {
    const blob = parseBearerBlob(authorization);
    if (!blob) {
        throw jiraError('jira_reconnect_required');
    }
    return createJiraCall(blob);
};

export const applyJiraSessionHeaders = (response: HeaderTarget, call: JiraCallContext): void => {
    response.setHeader('Cache-Control', 'no-store');
    if (call.refreshedBlob) {
        response.setHeader(JIRA_SESSION_HEADER, call.refreshedBlob);
    }
};
