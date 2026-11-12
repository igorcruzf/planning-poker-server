import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { corsOrigin } from './cors-origin';

const DEFAULT_PORT = 3001;

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.enableCors({ origin: corsOrigin() });
    await app.listen(Number(process.env.PORT) || DEFAULT_PORT);
}
bootstrap();
