export type ChangeListener<Change> = (change: Change) => void;

export class ChangeNotifier<Change> {
    private readonly listeners = new Set<ChangeListener<Change>>();

    subscribe(listener: ChangeListener<Change>): () => void {
        const registration: ChangeListener<Change> = (change) => listener(change);
        this.listeners.add(registration);
        return () => {
            this.listeners.delete(registration);
        };
    }

    notify(change: Change): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(change);
            } catch {
                continue;
            }
        }
    }
}
