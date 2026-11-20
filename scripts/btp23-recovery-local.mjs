import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(SUPABASE_|PG|S3_|AWS_|OPENAI_API_KEY$|DOCKER_HOST$|DOCKER_CONTEXT$)/i.test(key)));

export const excludedTables = [
  "auth.schema_migrations",
  "private.btp07_expiry_runs",
  "private.btp07_expiry_heartbeat",
];

function run(label, executable, args, input) {
  try {
    return execFileSync(executable, args, {
      env, input, timeout: 180_000, maxBuffer: 32 * 1024 * 1024,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(`${label} failed (${error.code ?? error.status ?? error.signal})`);
  }
}

export function candidateRevision() {
  const args = ["-C", fileURLToPath(new URL("../", import.meta.url))];
  return {
    commit: run("Read candidate commit", "git", [...args, "rev-parse", "HEAD"]).toString().trim(),
    dirty: run("Check candidate worktree", "git", [...args, "status", "--porcelain"]).length > 0,
  };
}

export function checkLocalTools() {
  const endpoint = run("Read Docker endpoint", "docker", ["context", "inspect", "--format",
    "{{.Endpoints.docker.Host}}"]).toString().trim();
  assert.match(endpoint, /^(?:npipe:\/\/|unix:\/\/)/, "Use a local Docker context");
  const version = run("Check Supabase CLI", "supabase", ["--version"]).toString().trim();
  assert.equal(version, "2.114.0", "Use the same Supabase CLI version as BeeTip CI");
}

async function availablePorts(count) {
  const listeners = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = createServer();
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      listeners.push(server);
    }
    return listeners.map(server => server.address().port);
  } finally {
    await Promise.all(listeners.map(server => new Promise(resolve => server.close(resolve))));
  }
}

export async function prepareStack(scratch, name) {
  const id = `beetip-btp23-${name}-${randomBytes(8).toString("hex")}`;
  const workdir = join(scratch, id);
  const project = join(workdir, "supabase");
  const repo = new URL("../supabase/", import.meta.url);
  await mkdir(project, { recursive: true });
  for (const directory of ["migrations", "templates"]) {
    await cp(new URL(directory, repo), join(project, directory), { recursive: true });
  }
  const config = await readFile(new URL("config.toml", repo), "utf8");
  const portLine = /^(port|shadow_port|inspector_port) = \d+\r?$/gm;
  const ports = await availablePorts([...config.matchAll(portLine)].length);
  let index = 0;
  const isolated = config.replace(/^project_id = "beetip"\r?$/m, `project_id = "${id}"`)
    .replace(portLine, (_, key) => `${key} = ${ports[index++]}`)
    .replace(/(\[db\.seed\][^[]*?enabled = )true/, "$1false");
  assert(isolated.includes(`project_id = "${id}"`), "Could not isolate project ID");
  assert.match(isolated, /\[db\.seed\][^[]*?enabled = false/);
  const apiPort = isolated.match(/\[api\][^[]*?^port = (\d+)$/m)?.[1];
  assert(apiPort);
  await writeFile(join(project, "config.toml"), isolated);
  return { id, workdir, origin: `http://127.0.0.1:${apiPort}` };
}

export function startStack(stack) {
  const args = ["--workdir", stack.workdir];
  run("Start isolated Supabase", "supabase", ["start", ...args, "-x",
    "studio,imgproxy,logflare,vector,edge-runtime,postgres-meta,mailpit,realtime"]);
  const status = JSON.parse(run("Read isolated Supabase status", "supabase", ["status", ...args, "-o", "json"]));
  assert.equal(new URL(status.API_URL).origin, stack.origin);
  assert(stack.origin.startsWith("http://127.0.0.1:"));
  assert(status.PUBLISHABLE_KEY && status.SERVICE_ROLE_KEY, "Missing local API credentials");
  stack.publishable = status.PUBLISHABLE_KEY;
  stack.serviceRole = status.SERVICE_ROLE_KEY;
}

export function stopStack(stack) {
  assert.match(stack.id, /^beetip-btp23-(?:source|target)-[a-f0-9]{16}$/);
  run("Stop isolated Supabase", "supabase", ["stop", "--workdir", stack.workdir,
    "--project-id", stack.id, "--no-backup"]);
}

function database(stack, label, program, args, input) {
  assert.match(stack.id, /^beetip-btp23-(?:source|target)-[a-f0-9]{16}$/);
  return run(label, "docker", ["exec", "-i", `supabase_db_${stack.id}`, program,
    "-U", "supabase_admin", "-d", "postgres", ...args], input);
}

export function sql(stack, statement) {
  return database(stack, "Run recovery SQL", "psql", ["-XqAt", "-v", "ON_ERROR_STOP=1"], statement).toString().trim();
}

export function dumpDatabase(stack) {
  return database(stack, "Dump synthetic database data", "pg_dump", ["--data-only", "--inserts",
    "--on-conflict-do-nothing", "--schema=public", "--schema=private", "--schema=auth",
    ...excludedTables.map(table => `--exclude-table=${table}`), "--no-owner", "--no-privileges"]);
}

export function restoreDatabase(stack, dump) {
  assert.match(stack.id, /^beetip-btp23-target-/);
  sql(stack, `begin;\nset session_replication_role = replica;\n${dump}\ncommit;`);
}
