import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JiraLoginService } from './jira-login.service';
import { JiraSessionService } from './jira-session.service';

export const JIRA_SWEEP_INTERVAL_MS = 60_000;

@Injectable()
export class JiraAuthMaintenance implements OnModuleInit, OnModuleDestroy {
    private timer?: NodeJS.Timeout;

    constructor(
        private readonly login: JiraLoginService,
        private readonly sessions: JiraSessionService,
    ) {}

    onModuleInit(): void {
        this.timer = setInterval(() => this.sweep(), JIRA_SWEEP_INTERVAL_MS);
        this.timer.unref();
    }

    onModuleDestroy(): void {
        clearInterval(this.timer);
        this.timer = undefined;
    }

    sweep(): void {
        this.login.sweep();
        this.sessions.sweep();
    }
}
