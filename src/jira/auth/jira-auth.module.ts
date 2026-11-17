import { ModuleMetadata, Module } from '@nestjs/common';
import { AtlassianAuthClient, FetchFunction } from './atlassian-auth.client';
import { JiraAuthController } from './jira-auth.controller';
import { JiraAuthMaintenance } from './jira-auth-maintenance';
import { JiraAuthConfig, loadJiraAuthConfig } from './jira-auth.config';
import {
    Clock,
    JIRA_AUTH_CONFIG,
    JIRA_CLOCK,
    JIRA_FETCH,
    JIRA_SLEEP,
    Sleep,
    realSleep,
    systemClock,
} from './jira-auth.tokens';
import { JiraLoginService } from './jira-login.service';
import { JiraSessionService } from './jira-session.service';

const defaultFetch: FetchFunction = (url, init) => fetch(url, init);

export interface JiraAuthOverrides {
    config?: JiraAuthConfig;
    clock?: Clock;
    sleep?: Sleep;
    fetch?: FetchFunction;
}

export const jiraAuthModuleMetadata = (overrides: JiraAuthOverrides = {}): ModuleMetadata => ({
    controllers: [JiraAuthController],
    providers: [
        { provide: JIRA_AUTH_CONFIG, useFactory: () => overrides.config ?? loadJiraAuthConfig() },
        { provide: JIRA_CLOCK, useValue: overrides.clock ?? systemClock },
        { provide: JIRA_SLEEP, useValue: overrides.sleep ?? realSleep },
        { provide: JIRA_FETCH, useValue: overrides.fetch ?? defaultFetch },
        AtlassianAuthClient,
        JiraSessionService,
        JiraLoginService,
        JiraAuthMaintenance,
    ],
    exports: [JiraSessionService],
});

@Module(jiraAuthModuleMetadata())
export class JiraAuthModule {}
