const STACK_FRAME = /^\s+at /;

const stackFramesOf = (error: Error): string[] =>
    (error.stack ?? '').split('\n').filter((line) => STACK_FRAME.test(line));

export const describeError = (error: unknown): string => {
    if (!(error instanceof Error)) {
        return `Non-error value of type ${typeof error}`;
    }
    return [error.name, ...stackFramesOf(error)].join('\n');
};
