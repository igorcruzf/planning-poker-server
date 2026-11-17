import type { IncomingMessage } from 'node:http';
import { Body, Controller, Get, Header, Headers, HttpCode, Post, Query, Redirect, Req, Res } from '@nestjs/common';
import { clientAddressOfRequest } from '../../gateway/session/client-address';
import {
    JIRA_API_PATHS,
    JIRA_AUTH_PATHS,
    JIRA_AUTHORIZATION_HEADER,
    JIRA_SESSION_HEADER,
    jiraLoginQuerySchema,
    jiraSessionRequestSchema,
} from '../../contracts';
import type { JiraSessionResponse, JiraStatusResponse } from '../../contracts';
import { JiraAppException, jiraError } from './jira-app.exception';
import { JiraLoginService } from './jira-login.service';
import { JiraSessionService, parseBearerBlob } from './jira-session.service';

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
    @Header('Cache-Control', NO_STORE)
    @Redirect()
    start(
        @Query() query: unknown,
        @Req() request: IncomingMessage,
        @Res({ passthrough: true }) response: HeaderWriter,
    ) {
        if (!this.login.enabled) {
            return {
                url: this.login.errorRedirect('jira_disabled'),
                statusCode: FOUND,
            };
        }
        const parsed = jiraLoginQuerySchema.safeParse(query);
        if (!parsed.success) {
            throw this.invalidQuery(parsed.error.issues);
        }
        const { url, setCookie } = this.login.beginLogin(clientAddressOfRequest(request), parsed.data.mesa);
        response.setHeader('Set-Cookie', setCookie);
        return { url, statusCode: FOUND };
    }

    @Get(JIRA_AUTH_PATHS.callback)
    @Header('Cache-Control', NO_STORE)
    @Redirect()
    async callback(
        @Query() query: unknown,
        @Headers('cookie') cookie: string | undefined,
        @Req() request: IncomingMessage,
        @Res({ passthrough: true }) response: HeaderWriter,
    ) {
        if (!this.login.enabled) {
            return {
                url: this.login.errorRedirect('jira_disabled'),
                statusCode: FOUND,
            };
        }
        const { url, setCookie } = await this.login.completeLogin(clientAddressOfRequest(request), query, cookie);
        response.setHeader('Set-Cookie', setCookie);
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
    @Header('Cache-Control', NO_STORE)
    closeSession(
        @Headers(JIRA_AUTHORIZATION_HEADER) authorization: string | undefined,
        @Req() request: IncomingMessage,
    ): void {
        if (!this.login.enabled) {
            throw jiraError('jira_disabled');
        }
        this.login.limitLogout(clientAddressOfRequest(request));
        const blob = parseBearerBlob(authorization);
        if (blob) {
            this.sessions.logout(blob);
        }
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
