#!/usr/bin/env bun

import { Client, crypto } from "acme-client";
import { writeFileSync } from "fs";
import { join } from "path";
import FREESSL_EAB from "../conf/FREESSL_EAB.js";

const conf = (name) => join(import.meta.dirname, "../conf", name),
  [kid, hmac_key] = FREESSL_EAB,
  account_key = await crypto.createPrivateKey(),
  client = new Client({
    directoryUrl: "https://acme.litessl.com/acme/v2/directory",
    accountKey: account_key,
    externalAccountBinding: { kid, hmacKey: hmac_key },
  });

await client.createAccount({ termsOfServiceAgreed: true });

const pem = account_key.toString(),
  account_url = client.getAccountUrl(),
  out = conf("FREESSL.js");

writeFileSync(out, `export default ${JSON.stringify([pem, account_url])}\n`);
console.log("done", out);
