import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export const CONTRACTS_DIR = join(__dirname, '..', 'contracts');

const listFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)],
    );

export const contractFiles = (): string[] => listFiles(CONTRACTS_DIR).sort();

export const readContract = (file: string): string => readFileSync(file, 'utf8');
