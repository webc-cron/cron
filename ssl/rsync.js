import { join } from "path";
import { readFile } from "fs/promises";
import { writeFileSync, mkdirSync, chmodSync } from "fs";
import { $ } from "@3-/zx";
import ROOT from "../ROOT.js";
$.verbose = 1;

const SSL = join(ROOT, "gen/ssl"),
  SSH_DIR = join(ROOT, "conf/ssh"),
  SSH_CONFIG = join(SSH_DIR, "ssh_config"),
  ID_ED25519 = join(SSH_DIR, "id_ed25519"),
  SSH_ARGS = `-F ${SSH_CONFIG} -i ${ID_ED25519} -o StrictHostKeyChecking=no`,
  HOST_LI = (await readFile(SSH_CONFIG, "utf8"))
    .split("\n")
    .filter((i) => i.startsWith("Host "))
    .map((i) => i.slice(5).trim())
    .filter((i) => i !== "*");

chmodSync(ID_ED25519, 0o600);

export const runHook = async () => {
  await Promise.all(
    HOST_LI.map(async (host) => {
      await $`ssh ${SSH_ARGS.split(" ")} ${host} "/usr/bin/env bash -c 'if [ -f /opt/hook/ssl.update ]; then /opt/hook/ssl.update; fi'"`;
    }),
  );
};

const main = async (domain, key_crt) => {
  const dir = join(SSL, domain),
    ssl_dir = `/mnt/ssl/${domain}`;

  mkdirSync(dir, { recursive: true });
  ["key", "crt"].forEach((i, idx) => writeFileSync(join(dir, `${i}.pem`), key_crt[idx]));

  await Promise.all(
    HOST_LI.map(async (host) => {
      await $`ssh ${SSH_ARGS.split(" ")} ${host} "mkdir -p ${ssl_dir}"`;
      await $`rsync -avzL --delete -e ${"ssh " + SSH_ARGS} ${dir}/ ${host}:${ssl_dir}/`;
    }),
  );
};

export default main;
