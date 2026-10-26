import { createTelegramHandler } from "../_shared/telegram.ts";

declare const Deno: {
  env: { toObject(): Record<string, string> };
  serve(handler: (request: Request) => Promise<Response>): void;
};

Deno.serve(createTelegramHandler("webhook", Deno.env.toObject()));
