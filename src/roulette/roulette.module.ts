import { Module } from "@nestjs/common";
import { CryptoRandomSource, RandomSource } from "./random-source";
import { RouletteService } from "./roulette.service";

@Module({
  providers: [
    { provide: RandomSource, useClass: CryptoRandomSource },
    RouletteService,
  ],
  exports: [RouletteService],
})
export class RouletteModule {}
