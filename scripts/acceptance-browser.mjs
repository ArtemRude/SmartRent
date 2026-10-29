import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCEPTANCE_PROJECT_URL,
  acceptanceStateDirectory,
  acceptanceBrowserLink,
} from "./acceptance-live.mjs";

const roleNames = {
  owner: "Тестовый собственник",
  tenant: "Тестовый арендатор",
  manager: "Тестовый управляющий",
};

export function validateBrowserFixture(manifest, directory) {
  if (
    !manifest ||
    manifest.version !== 1 ||
    manifest.status !== "ready" ||
    manifest.project_url !== ACCEPTANCE_PROJECT_URL ||
    resolve(directory) !== acceptanceStateDirectory(manifest.run_id)
  )
    throw new Error("invalid_fixture");
  for (const role of Object.keys(roleNames)) {
    const user = manifest.users?.[role];
    if (
      !user ||
      user.email !== `acceptance-${manifest.run_id}-${role}@example.invalid` ||
      !/^[0-9a-f-]{36}$/.test(user.id)
    )
      throw new Error("invalid_fixture");
  }
  if (
    !manifest.property ||
    manifest.property.owner_id !== manifest.users.owner.id ||
    manifest.property.name !== `ТЕСТ ПРИЁМКИ ${manifest.run_id}`
  )
    throw new Error("invalid_fixture");
}

export function validateBrowserCallback(link, role, userId) {
  if (
    !(role in roleNames) ||
    !Object.hasOwn(roleNames, role) ||
    link?.user_id !== userId ||
    typeof link?.url !== "string"
  )
    throw new Error("invalid_fixture_callback");
  return acceptanceBrowserLink(role, userId, {
    user: { id: userId },
    properties: { action_link: link.url },
  }).url;
}

async function readPrivateJson(directory, name) {
  const file = join(directory, name);
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error("insecure_fixture_file");
  return JSON.parse(await readFile(file, "utf8"));
}

/** Local, one-use redirect to normal Supabase Auth; no tokens enter page HTML or logs. */
export async function serveAcceptanceBrowser(directory) {
  const manifest = await readPrivateJson(directory, "manifest.json");
  validateBrowserFixture(manifest, directory);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error("insecure_fixture_directory");
  const links = await readPrivateJson(directory, "browser-links.json");
  const callbacks = Object.fromEntries(
    Object.keys(roleNames).map((role) => [
      role,
      validateBrowserCallback(links[role], role, manifest.users[role].id),
    ]),
  );
  const ticket = randomBytes(32).toString("hex");
  let consumed = {};
  try {
    consumed = await readPrivateJson(directory, "browser-consumed.json");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const server = createServer(async (request, response) => {
    const headers = {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
      "Content-Type": "text/html; charset=utf-8",
    };
    try {
      if (
        request.method !== "GET" ||
        request.socket.remoteAddress !== "127.0.0.1" ||
        request.headers.host !== `127.0.0.1:${server.address().port}` ||
        (request.headers["sec-fetch-site"] &&
          !["same-origin", "none"].includes(request.headers["sec-fetch-site"]))
      ) {
        response.writeHead(403, headers);
        response.end("Forbidden");
        return;
      }
      if (request.url === "/") {
        const buttons = Object.entries(roleNames)
          .map(([role, label]) =>
            consumed[role]
              ? `<p>${label}: ссылка уже использована</p>`
              : `<p><a href="/${ticket}/${role}">Войти: ${label}</a></p>`,
          )
          .join("");
        response.writeHead(200, headers);
        response.end(
          `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Приёмка SmartRent</title><style>body{font:16px/1.7 system-ui;margin:40px auto;padding:20px;max-width:660px;color:#24453e;background:#f7f5f1}a{display:inline-block;padding:12px 18px;background:#24776d;color:white;border-radius:12px;text-decoration:none}</style><h1>Приёмка SmartRent</h1><p>Только отдельные тестовые аккаунты. Вход выполняется через Supabase; пароли и рабочие аккаунты не меняются.</p>${buttons}<p>Между ролями открывайте эту страницу заново. Все вкладки SmartRent в этом браузере используют общий вход.</p></html>`,
        );
        return;
      }
      const role = request.url?.slice(`/${ticket}/`.length);
      if (
        !request.url?.startsWith(`/${ticket}/`) ||
        !Object.hasOwn(callbacks, role) ||
        consumed[role]
      ) {
        response.writeHead(404, headers);
        response.end("Not found");
        return;
      }
      consumed[role] = new Date().toISOString();
      await writeFile(join(directory, "browser-consumed.json"), JSON.stringify(consumed), {
        mode: 0o600,
      });
      response.writeHead(303, { ...headers, Location: callbacks[role] });
      response.end();
    } catch {
      response.writeHead(503, headers);
      response.end("Временная ошибка тестового входа");
    }
  });
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  console.log(
    JSON.stringify({
      status: "listening",
      url: `http://127.0.0.1:${server.address().port}`,
      state_dir: directory,
    }),
  );
  const timer = setTimeout(() => server.close(), 60 * 60 * 1000);
  server.on("close", () => clearTimeout(timer));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 2 || process.argv[2] === "--plan") {
    console.log(
      JSON.stringify({
        status: "plan",
        usage: "node scripts/acceptance-browser.mjs --serve /tmp/smartrent-acceptance-<UUID>",
        scope: "fixture_only_one_use_supabase_redirect",
        bind: "127.0.0.1",
      }),
    );
  } else if (process.argv.length === 4 && process.argv[2] === "--serve") {
    serveAcceptanceBrowser(process.argv[3]).catch(() => {
      console.log(JSON.stringify({ status: "rejected", error: "invalid_private_fixture" }));
      process.exitCode = 1;
    });
  } else {
    console.log(JSON.stringify({ status: "rejected", error: "invalid_arguments" }));
    process.exitCode = 1;
  }
}
