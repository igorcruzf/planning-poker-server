import { randomInt } from "node:crypto";

export abstract class RandomSource {
  abstract nextInt(maxExclusive: number): number;
}

export class CryptoRandomSource extends RandomSource {
  nextInt(maxExclusive: number): number {
    return randomInt(maxExclusive);
  }
}
