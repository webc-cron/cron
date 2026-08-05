import { ssl } from "tencentcloud-sdk-nodejs-ssl";
import { teo } from "tencentcloud-sdk-nodejs-teo";
import { SecretId, SecretKey } from "../conf/TENCENT.js";

const OPT = {
    credential: { secretId: SecretId, secretKey: SecretKey },
    region: "ap-guangzhou",
  },
  ssl_client = new ssl.v20191205.Client(OPT),
  teo_client = new teo.v20220901.Client(OPT);

export default async (updates) => {
  for (const [domain, { key_crt: [key, crt], host_conf }] of updates) {
    if (!host_conf) continue;

    const { Zones = [] } = await teo_client.DescribeZones({ Limit: 100 }),
      zone = Zones.find((z) => z.ZoneName === domain);

    if (!zone) throw new Error(`Zone for domain ${domain} not found in Tencent EdgeOne`);

    const { AccelerationDomains = [] } = await teo_client.DescribeAccelerationDomains({
        ZoneId: zone.ZoneId,
      }),
      hosts = AccelerationDomains.map((d) => d.DomainName);

    if (!hosts.length) {
      console.log(`No acceleration hosts found for ${domain} in EdgeOne.`);
      continue;
    }

    const { CertificateId } = await ssl_client.UploadCertificate({
      CertificatePublicKey: crt,
      CertificatePrivateKey: key,
      CertificateType: "SVR",
      Alias: `${domain}-${Date.now()}`,
    });

    await teo_client.ModifyHostsCertificate({
      ZoneId: zone.ZoneId,
      Hosts: hosts,
      Mode: "sslcert",
      ServerCertInfo: [{ CertId: CertificateId }],
    });

    console.log(`Updated ${domain} in EdgeOne (CertId: ${CertificateId}, Hosts: ${hosts.join(", ")})`);
  }
};
