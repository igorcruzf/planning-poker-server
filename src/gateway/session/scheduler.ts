export type CancelTimer = () => void;

export abstract class Scheduler {
    abstract after(delayMs: number, task: () => void): CancelTimer;
}

export class SystemScheduler extends Scheduler {
    after(delayMs: number, task: () => void): CancelTimer {
        const timer = setTimeout(task, delayMs);
        return () => clearTimeout(timer);
    }
}
