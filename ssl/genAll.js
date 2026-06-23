import cdn from "./cdn.js";
import { X509Certificate } from "crypto";
import retry from "@3-/retry";
import Freessl from "@3-/ssl/Freessl.js";
import FREESSL from "../conf/FREESSL.js";
import HOST_HW from "../conf/host/HW.js";
import R from "./R.js";
import DNS from "./DNS.js";
import rsync, { runHook } from "./rsync.js";

const NOW = new Date(),
  SSL_CLIENT = Freessl(...FREESSL),
  gen = retry(async (dns, domain, sync) => {
    const r_key = "ssl:" + domain;
    let key_crt = await R.get(r_key),
      renew = 0;

    if (key_crt) {
      key_crt = JSON.parse(key_crt);
      const expire = new Date(new X509Certificate(key_crt[1]).validTo);
      if ((expire - NOW) / 864e5 > 30) {
        console.log(domain, "expire", expire.toISOString().slice(0, 10));
        if (!sync) {
          return 0;
        }
      } else {
        renew = 1;
      }
    } else {
      renew = 1;
    }

    console.log(dns, domain);

    const { reset, rm } = await DNS[dns](domain);

    if (renew) {
      const set_done = new Set();
      key_crt = await SSL_CLIENT(
        domain,
        async (prefix, val) => {
          if (set_done.has(val)) return;
          set_done.add(val);
          await reset(prefix, { TXT: Array.from(set_done) });
          await new Promise((resolve) => setTimeout(resolve, 10000));
        },
        rm,
      );
      await R.set(r_key, JSON.stringify(key_crt), { EX: 7776e3 });
    }

    await rsync(domain, key_crt);

    return key_crt;
  }),
  genAll = async (sync) => {
    const updates = new Map();
    for (const domain of Object.keys(HOST_HW)) {
      const key_crt = await gen("hw", domain, sync);
      if (key_crt) {
        updates.set(domain, key_crt);
      }
    }
    if (updates.size > 0) {
      await runHook();
      if (!sync) {
        await cdn(updates);
      }
    }
  };

export default genAll;
