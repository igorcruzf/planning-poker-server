import { Module } from '@nestjs/common';
import { JiraApiClient } from '../api/jira-api.client';
import { JiraTransport } from '../api/jira-transport';
import { FetchFunction } from '../auth/atlassian-auth.client';
import { JiraAuthModule } from '../auth/jira-auth.module';
import { JIRA_FETCH, JIRA_SLEEP, realSleep } from '../auth/jira-auth.tokens';
import { JiraIssuesService } from './jira-issues.service';

const defaultFetch: FetchFunction = (url, init) => fetch(url, init);

@Module({
    imports: [JiraAuthModule],
    providers: [
        { provide: JIRA_FETCH, useValue: defaultFetch },
        { provide: JIRA_SLEEP, useValue: realSleep },
        JiraTransport,
        JiraApiClient,
        JiraIssuesService,
    ],
    exports: [JiraApiClient, JiraIssuesService],
})
export class JiraHttpModule {}
