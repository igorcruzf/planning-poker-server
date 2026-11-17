import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JiraApiClient } from '../api/jira-api.client';
import { JiraAuthModule } from '../auth/jira-auth.module';
import { JiraHttpModule } from './jira-http.module';
import { JiraIssuesService } from './jira-issues.service';

@Module({ imports: [JiraAuthModule, JiraHttpModule] })
class HostModule {}

describe('JiraHttpModule', () => {
    it('exposes the issues service and the API client wired to the Jira session', async () => {
        const context = await NestFactory.createApplicationContext(HostModule, { logger: false });

        expect(context.get(JiraIssuesService, { strict: false })).toBeInstanceOf(JiraIssuesService);
        expect(context.get(JiraApiClient, { strict: false })).toBeInstanceOf(JiraApiClient);
        await context.close();
    });
});
