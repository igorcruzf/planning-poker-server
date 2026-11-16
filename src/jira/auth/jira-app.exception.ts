import { HttpException } from '@nestjs/common';
import { AppError, ERROR_HTTP_STATUS, ErrorCode, HttpErrorBody } from '../../contracts';

export class JiraAppException extends HttpException {
    constructor(readonly error: AppError) {
        super({ error } satisfies HttpErrorBody, ERROR_HTTP_STATUS[error.code]);
    }

    get code(): ErrorCode {
        return this.error.code;
    }
}

export const jiraError = (code: Exclude<ErrorCode, 'jira_rate_limited' | 'rate_limited'>) =>
    new JiraAppException({ code } as AppError);

export const rateLimitedError = (code: 'jira_rate_limited' | 'rate_limited', retryAfterMs: number) =>
    new JiraAppException({ code, retryAfterMs });
