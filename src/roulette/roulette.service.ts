import { Injectable } from "@nestjs/common";
import {
  INVALID_PAYLOAD_MAX_ISSUES,
  INVALID_PAYLOAD_TEXT_MAX_LENGTH,
  RouletteSpinPayload,
  RouletteSpun,
  rouletteSpinPayloadSchema,
  rouletteSpunSchema,
} from "../contracts";
import { DomainError } from "../domain/domain-error";
import { CryptoRandomSource, RandomSource } from "./random-source";

const INVALID_ISSUE_MESSAGE = "invalid_payload";

@Injectable()
export class RouletteService {
  constructor(
    private readonly random: RandomSource = new CryptoRandomSource(),
  ) {}

  spin(input: unknown): RouletteSpun {
    const payload = this.parse(input);
    const present = payload.names.filter(
      (name) => !payload.absent.includes(name),
    );
    const result: RouletteSpun =
      payload.mode === "leader"
        ? this.drawLeader(present, payload.alreadyDrawn)
        : { mode: "speaking_order", order: this.shuffle(present) };
    return rouletteSpunSchema.parse(result);
  }

  private parse(input: unknown): RouletteSpinPayload {
    const parsed = rouletteSpinPayloadSchema.safeParse(input);
    if (parsed.success) return parsed.data;
    const issues = parsed.error.issues
      .slice(0, INVALID_PAYLOAD_MAX_ISSUES)
      .map((issue) => ({
        path: issue.path.join(".").slice(0, INVALID_PAYLOAD_TEXT_MAX_LENGTH),
        message: INVALID_ISSUE_MESSAGE,
      }));
    throw new DomainError({ code: "invalid_payload", issues });
  }

  private drawLeader(
    present: readonly string[],
    alreadyDrawn: readonly string[],
  ): RouletteSpun {
    const remaining = present.filter((name) => !alreadyDrawn.includes(name));
    const cycleRestarted = remaining.length === 0;
    const eligible = cycleRestarted ? present : remaining;
    return {
      mode: "leader",
      winner: eligible[this.random.nextInt(eligible.length)],
      cycleRestarted,
    };
  }

  private shuffle(names: readonly string[]): string[] {
    const order = [...names];
    for (let last = order.length - 1; last > 0; last--) {
      const picked = this.random.nextInt(last + 1);
      [order[last], order[picked]] = [order[picked], order[last]];
    }
    return order;
  }
}
