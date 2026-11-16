import { Clock } from '../clock';

export class FakeClock extends Clock {
    constructor(private current = 1_700_000_000_000) {
        super();
    }

    now(): number {
        return this.current;
    }

    advance(milliseconds: number): void {
        this.current += milliseconds;
    }
}
