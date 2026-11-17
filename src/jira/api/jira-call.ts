export interface JiraSite {
    cloudId: string;
    siteUrl: string;
}

export interface JiraCallContext {
    readonly blob: string;
    refreshedBlob?: string;
    site?: JiraSite;
}

export const createJiraCall = (blob: string): JiraCallContext => ({ blob });
