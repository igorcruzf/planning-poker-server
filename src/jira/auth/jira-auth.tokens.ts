export type Clock = () => number;
export type Sleep = (ms: number) => Promise<void>;

export const JIRA_AUTH_CONFIG = Symbol('JIRA_AUTH_CONFIG');
export const JIRA_CLOCK = Symbol('JIRA_CLOCK');
export const JIRA_SLEEP = Symbol('JIRA_SLEEP');
export const JIRA_FETCH = Symbol('JIRA_FETCH');

export const systemClock: Clock = () => Date.now();
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
