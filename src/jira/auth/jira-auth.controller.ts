import { Body, Controller, Get, Header, Headers, HttpCode, Post, Query, Redirect, Res } from '@nestjs/common';
import {
    JIRA_API_PATHS,
    JIRA_AUTH_PATHS,
    JIRA_AUTHORIZATION_HEADER,
    JIRA_AUTHORIZATION_SCHEME,
    JIRA_SESSION_HEADER,
    jiraAuthorizationHeaderSchema,
    jiraLoginQuerySchema,
    jiraSessionRequestSchema,
} from '../../contracts';
import type { JiraSessionResponse, JiraStatusResponse } from '../../contracts';
import { JiraAppException, jiraError } from './jira-app.exception';
import { JiraLoginService } from './jira-login.service';
import { JiraSessionService } from './jira-session.service';

interface HeaderWriter {
    setHeader(name: string, value: string): void;
}

const FOUND = 302;
const NO_STORE = 'no-store';

@Controller()
export class JiraAuthController {
    constructor(
        private readonly login: JiraLoginService,
        private readonly sessions: JiraSessionService,
    ) {}

    @Get(JIRA_API_PATHS.status)
    @Header('Cache-Control', NO_STORE)
    status(): JiraStatusResponse {
        return { enabled: this.login.enabled };
    }

    @Get(JIRA_AUTH_PATHS.login)
    @Redirect()
    start(@Query() query: unknown) {
        if (!this.login.enabled) {
            return { url: this.login.errorRedirect('jira_disabled'), statusCode: FOUND };
        }
        const parsed = jiraLoginQuerySchema.safeParse(query);
        if (!parsed.success) {
            throw this.invalidQuery(parsed.error.issues);
        }
        return { url: this.login.beginLogin(parsed.data.mesa), statusCode: FOUND };
    }

    @Get(JIRA_AUTH_PATHS.callback)
    @Redirect()
    async callback(@Query() query: unknown) {
        const url = this.login.enabled
            ? await this.login.completeLogin(query)
            : this.login.errorRedirect('jira_disabled');
        return { url, statusCode: FOUND };
    }

    @Post(JIRA_AUTH_PATHS.session)
    @HttpCode(200)
    @Header('Cache-Control', NO_STORE)
    openSession(@Body() body: unknown, @Res({ passthrough: true }) response: HeaderWriter): JiraSessionResponse {
        if (!this.login.enabled) {
            throw jiraError('jira_disabled');
        }
        const parsed = jiraSessionRequestSchema.safeParse(body);
        if (!parsed.success) {
            throw jiraError('jira_login_code_invalid');
        }
        const { blob, siteUrl } = this.login.redeemCode(parsed.data.code);
        response.setHeader(JIRA_SESSION_HEADER, blob);
        return { siteUrl };
    }

    @Post(JIRA_AUTH_PATHS.logout)
    @HttpCode(204)
    closeSession(@Headers(JIRA_AUTHORIZATION_HEADER) authorization?: string): void {
        if (!this.login.enabled) {
            throw jiraError('jira_disabled');
        }
        const blob = this.bearerBlob(authorization);
        if (blob) {
            this.sessions.logout(blob);
        }
    }

    private bearerBlob(authorization?: string): string | undefined {
        if (!jiraAuthorizationHeaderSchema.safeParse(authorization).success) {
            return undefined;
        }
        return authorization!.slice(JIRA_AUTHORIZATION_SCHEME.length + 1);
    }

    private invalidQuery(issues: { path: PropertyKey[]; message: string }[]): JiraAppException {
        return new JiraAppException({
            code: 'invalid_payload',
            issues: issues.slice(0, 20).map((issue) => ({
                path: issue.path.map(String).join('.').slice(0, 200),
                message: issue.message.slice(0, 200),
            })),
        });
    }
}
