import { rouletteSpunSchema } from "../contracts";
import { DomainError } from "../domain/domain-error";
import { RandomSource } from "./random-source";
import { RouletteModule } from "./roulette.module";
import { RouletteService } from "./roulette.service";

class ScriptedRandomSource extends RandomSource {
  readonly requestedBounds: number[] = [];
  constructor(private readonly values: number[]) {
    super();
  }
  nextInt(maxExclusive: number): number {
    this.requestedBounds.push(maxExclusive);
    return this.values.shift() ?? 0;
  }
}

class CyclingRandomSource extends RandomSource {
  private next = 0;
  nextInt(maxExclusive: number): number {
    return this.next++ % maxExclusive;
  }
}

const serviceWith = (random: RandomSource) => new RouletteService(random);
const errorOf = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return (error as DomainError).error;
  }
  throw new Error("expected DomainError");
};

describe("RouletteService.spin", () => {
  describe("leader", () => {
    it("sorteia entre presentes que ainda não foram sorteados", () => {
      const service = serviceWith(new ScriptedRandomSource([1]));
      const result = service.spin({
        mode: "leader",
        names: ["Ana", "Bia", "Caio", "Davi"],
        absent: ["Ana"],
        alreadyDrawn: ["Bia"],
      });
      expect(result).toEqual({
        mode: "leader",
        winner: "Davi",
        cycleRestarted: false,
      });
    });

    it("pede ao sorteador um valor abaixo da quantidade de elegíveis", () => {
      const random = new ScriptedRandomSource([0]);
      serviceWith(random).spin({
        mode: "leader",
        names: ["Ana", "Bia", "Caio"],
        alreadyDrawn: ["Ana"],
      });
      expect(random.requestedBounds).toEqual([2]);
    });

    it("devolve o único elegível", () => {
      const result = serviceWith(new ScriptedRandomSource([0])).spin({
        mode: "leader",
        names: ["Ana"],
      });
      expect(result).toEqual({
        mode: "leader",
        winner: "Ana",
        cycleRestarted: false,
      });
    });

    it("reinicia o ciclo quando todos os presentes já foram sorteados", () => {
      const result = serviceWith(new ScriptedRandomSource([1])).spin({
        mode: "leader",
        names: ["Ana", "Bia", "Caio"],
        absent: ["Caio"],
        alreadyDrawn: ["Ana", "Bia"],
      });
      expect(result).toEqual({
        mode: "leader",
        winner: "Bia",
        cycleRestarted: true,
      });
    });

    it("reinicia o ciclo quando os únicos não sorteados estão ausentes", () => {
      const result = serviceWith(new ScriptedRandomSource([0])).spin({
        mode: "leader",
        names: ["Ana", "Bia"],
        absent: ["Bia"],
        alreadyDrawn: ["Ana"],
      });
      expect(result).toEqual({
        mode: "leader",
        winner: "Ana",
        cycleRestarted: true,
      });
    });

    it("nunca sorteia ausente", () => {
      const service = serviceWith(new CyclingRandomSource());
      const winners = Array.from({ length: 30 }, () =>
        service.spin({
          mode: "leader",
          names: ["Ana", "Bia", "Caio"],
          absent: ["Bia"],
        }),
      );
      expect(
        winners.map((result) =>
          result.mode === "leader" ? result.winner : "",
        ),
      ).not.toContain("Bia");
    });

    it("distribui sem viés quando a fonte percorre todos os valores", () => {
      const service = serviceWith(new CyclingRandomSource());
      const names = ["Ana", "Bia", "Caio", "Davi", "Eva"];
      const counts = new Map<string, number>();
      for (let i = 0; i < names.length * 100; i++) {
        const result = service.spin({ mode: "leader", names });
        if (result.mode === "leader")
          counts.set(result.winner, (counts.get(result.winner) ?? 0) + 1);
      }
      expect([...counts.keys()].sort()).toEqual([...names].sort());
      expect([...counts.values()]).toEqual([100, 100, 100, 100, 100]);
    });
  });

  describe("speaking_order", () => {
    it("embaralha só os presentes com Fisher-Yates", () => {
      const random = new ScriptedRandomSource([1, 0]);
      const result = serviceWith(random).spin({
        mode: "speaking_order",
        names: ["Ana", "Bia", "Caio", "Davi"],
        absent: ["Davi"],
      });
      expect(result).toEqual({
        mode: "speaking_order",
        order: ["Caio", "Ana", "Bia"],
      });
      expect(random.requestedBounds).toEqual([3, 2]);
    });

    it("ignora alreadyDrawn e mantém todos os presentes", () => {
      const result = serviceWith(new ScriptedRandomSource([0, 0])).spin({
        mode: "speaking_order",
        names: ["Ana", "Bia", "Caio"],
        alreadyDrawn: ["Ana", "Bia"],
      });
      expect(
        result.mode === "speaking_order" && [...result.order].sort(),
      ).toEqual(["Ana", "Bia", "Caio"]);
    });

    it("devolve a única pessoa presente sem consumir sorteio", () => {
      const random = new ScriptedRandomSource([]);
      const result = serviceWith(random).spin({
        mode: "speaking_order",
        names: ["Ana", "Bia"],
        absent: ["Bia"],
      });
      expect(result).toEqual({ mode: "speaking_order", order: ["Ana"] });
      expect(random.requestedBounds).toEqual([]);
    });

    it("gera cada permutação exatamente uma vez com fonte exaustiva", () => {
      const seen = new Map<string, number>();
      for (let first = 0; first < 3; first++) {
        for (let second = 0; second < 2; second++) {
          const result = serviceWith(
            new ScriptedRandomSource([first, second]),
          ).spin({
            mode: "speaking_order",
            names: ["A", "B", "C"],
          });
          const key =
            result.mode === "speaking_order" ? result.order.join("") : "";
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      }
      expect(seen.size).toBe(6);
      expect([...seen.values()]).toEqual([1, 1, 1, 1, 1, 1]);
    });
  });

  describe("validação", () => {
    it.each([
      ["sem nomes", { mode: "leader", names: [] }],
      ["todos ausentes", { mode: "leader", names: ["Ana"], absent: ["Ana"] }],
      ["nomes repetidos", { mode: "leader", names: ["Ana", "Ana"] }],
      [
        "ausente fora da lista",
        { mode: "leader", names: ["Ana"], absent: ["Zé"] },
      ],
      ["modo desconhecido", { mode: "dado", names: ["Ana"] }],
      ["campo extra", { mode: "leader", names: ["Ana"], extra: 1 }],
      ["payload nulo", null],
    ])("rejeita %s com invalid_payload", (_label, payload) => {
      expect(
        errorOf(() => serviceWith(new CyclingRandomSource()).spin(payload))
          .code,
      ).toBe("invalid_payload");
    });

    it("não repassa mensagem crua do zod nem a chave enviada pelo cliente", () => {
      const error = errorOf(() =>
        serviceWith(new CyclingRandomSource()).spin({
          mode: "leader",
          names: ["Ana"],
          "<img src=x>": 1,
        }),
      );
      expect(JSON.stringify(error)).not.toContain("<img");
    });

    it("aceita 50 nomes e rejeita 51", () => {
      const names = (count: number) =>
        Array.from({ length: count }, (_, i) => `Pessoa ${i}`);
      const service = serviceWith(new CyclingRandomSource());
      expect(
        service.spin({ mode: "speaking_order", names: names(50) }),
      ).toMatchObject({ mode: "speaking_order" });
      expect(
        errorOf(() =>
          service.spin({ mode: "speaking_order", names: names(51) }),
        ).code,
      ).toBe("invalid_payload");
    });

    it("a saída passa no schema de resultado", () => {
      const service = serviceWith(new CyclingRandomSource());
      for (const mode of ["leader", "speaking_order"] as const) {
        expect(
          rouletteSpunSchema.safeParse(
            service.spin({ mode, names: ["Ana", "Bia"] }),
          ).success,
        ).toBe(true);
      }
    });
  });

  describe("RouletteModule", () => {
    it("exporta o serviço e usa o sorteador criptográfico por padrão", () => {
      expect(Reflect.getMetadata("exports", RouletteModule)).toContain(
        RouletteService,
      );
      const result = new RouletteService().spin({
        mode: "leader",
        names: ["Ana"],
      });
      expect(result).toEqual({
        mode: "leader",
        winner: "Ana",
        cycleRestarted: false,
      });
    });
  });
});
