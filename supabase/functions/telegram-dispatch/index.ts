import { createTelegramHandler } from "../_shared/telegram.ts";

declare const Deno: {
  env: { toObject(): Record<string, string> };
  serve(handler: (request: Request) => Promise<Response>): void;
};

Deno.serve(createTelegramHandler("dispatch", Deno.env.toObject()));
