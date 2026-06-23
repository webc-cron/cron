import HOST_HW from "../conf/host/HW.js";
import { ssl } from "tencentcloud-sdk-nodejs-ssl";
import { teo } from "tencentcloud-sdk-nodejs-teo";
import { SecretId, SecretKey } from "../conf/TENCENT.js";

const SSL_CLIENT_CLASS = ssl.v20191205.Client,
  TEO_CLIENT_CLASS = teo.v20220901.Client,
  ssl_client = new SSL_CLIENT_CLASS({
    credential: { secretId: SecretId, secretKey: SecretKey },
    region: "ap-guangzhou",
  }),
  teo_client = new TEO_CLIENT_CLASS({
    credential: { secretId: SecretId, secretKey: SecretKey },
    region: "ap-guangzhou",
  });

export default async (updates) => {
  for (const [domain, [key, crt]] of updates) {
    const host_conf = HOST_HW[domain];
    if (!host_conf) {
      console.log(`No host configuration found for ${domain}`);
      continue;
    }
    const tencent_conf = host_conf.TENCENT;
    if (!tencent_conf) {
      console.log(`No Tencent configuration found for ${domain}`);
      continue;
    }
    const edgeone = tencent_conf.edgeone;
    if (edgeone) {
      console.log(`Uploading certificate for ${domain}...`);
      const upload_res = await ssl_client.UploadCertificate({
        CertificatePublicKey: crt,
        CertificatePrivateKey: key,
        CertificateType: "SVR",
        Alias: `${domain}-${Date.now()}`,
      });
      const cert_id = upload_res.CertificateId;
      console.log(`Uploaded certificate to Tencent SSL. CertId: ${cert_id}`);

      const hosts = edgeone.map((sub) => (sub ? `${sub}.${domain}` : domain));
      console.log(`Hosts to update in EdgeOne:`, hosts);

      console.log(`Fetching ZoneId for ${domain}...`);
      const zones_res = await teo_client.DescribeZones({ Limit: 100 });
      const zone = (zones_res.Zones || []).find((z) => z.ZoneName === domain);
      if (!zone) {
        throw new Error(`Zone for domain ${domain} not found in Tencent EdgeOne`);
      }
      const zone_id = zone.ZoneId;
      console.log(`Found ZoneId: ${zone_id}`);

      console.log(`Updating hosts certificate in EdgeOne...`);
      await teo_client.ModifyHostsCertificate({
        ZoneId: zone_id,
        Hosts: hosts,
        Mode: "sslcert",
        ServerCertInfo: [
          {
            CertId: cert_id,
          },
        ],
      });
      console.log(`Successfully updated certificate for ${domain} in Tencent EdgeOne!`);
    }
  }
};
