export abstract class Clock {
    abstract now(): number;
}

export class SystemClock extends Clock {
    now(): number {
        return Date.now();
    }
}
