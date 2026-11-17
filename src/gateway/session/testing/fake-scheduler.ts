import { FakeClock } from '../../../domain/testing/fake-clock';
import { CancelTimer, Scheduler } from '../scheduler';

interface PendingTask {
    dueAt: number;
    task: () => void;
}

export class FakeScheduler extends Scheduler {
    private readonly pending = new Set<PendingTask>();

    constructor(private readonly clock: FakeClock) {
        super();
    }

    get pendingCount(): number {
        return this.pending.size;
    }

    after(delayMs: number, task: () => void): CancelTimer {
        const entry = { dueAt: this.clock.now() + delayMs, task };
        this.pending.add(entry);
        return () => {
            this.pending.delete(entry);
        };
    }

    advance(milliseconds: number): void {
        this.clock.advance(milliseconds);
        const due = [...this.pending].filter(({ dueAt }) => dueAt <= this.clock.now());
        due.forEach((entry) => {
            this.pending.delete(entry);
            entry.task();
        });
    }
}
