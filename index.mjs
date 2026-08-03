#!/usr/bin/env node
/* Samsung TV certificates, without the GUI.
 *
 * Sideloading anything onto a 2023+ Samsung television needs a Samsung-issued
 * distribution certificate. Tizen's own bundled distributor certificates all
 * fail with `Invalid certificate chain` on these sets — both the pair that
 * expired in 2022 and the `-new` pair valid to 2032 — so it is a trust-chain
 * problem, not an expiry one, and there is no way around it. The documented
 * route is Tizen Studio's Certificate Manager, a GUI inside an Eclipse
 * distribution, which is a heavy thing to install to click four buttons.
 *
 * This reimplements what that GUI does, against the endpoints and multipart
 * shapes read out of `org.tizen.common.cert`:
 *
 *   login    account.samsung.com OAuth2 -> http://localhost:4794/signin/callback
 *   author   POST svdca.samsungqbe.com/apis/v3/authors
 *   distrib  POST svdca.samsungqbe.com/apis/v3/distributors  (+ v1 for the xml)
 *
 * Your Samsung password goes to Samsung, in your own browser. Only the OAuth
 * callback reaches this process.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import http from "http";
import https from "https";
import { execFile } from "child_process";
import forge from "node-forge";

/* ---------------- arguments ---------------- */

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf("--" + name);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  return fallback;
}
const has = (name) => argv.includes("--" + name);

if (has("help") || has("h")) {
  console.log(`
samsung-tv-cert — issue Samsung TV author + distributor certificates headlessly

  npx samsung-tv-cert --duid <DUID>

Required
  --duid <id>        Your TV's DUID. On the TV: Apps, press 1 2 3 4 5, read it
                     off the Developer Mode panel. The distributor certificate
                     is bound to it; a wrong one signs fine and installs nothing.

Optional
  --profile <name>   Output folder name under SamsungCertificate (default: Tizen)
  --name <str>       commonName in the author certificate  (default: Tizen Developer)
  --org <str>        organizationName                       (default: Independent)
  --city <str>       localityName                           (default: Unknown)
  --state <str>      stateOrProvinceName                    (default: Unknown)
  --country <cc>     two-letter country code                (default: US)
  --password <str>   p12 password. Generated and saved if omitted.
  --password-file <p>  where to read/write that password
                       (default: ~/.samsung-tv-cert-password)
  --out <dir>        output directory
                     (default: ~/tizen-studio-data/SamsungCertificate/<profile>)
  --ca <dir>         Samsung CA certificates directory
                     (default: ~/tizen-studio-data/samsung-ca)

Environment equivalents: TV_DUID, CERT_PROFILE, CERT_NAME, CERT_ORG, CERT_CITY,
CERT_STATE, CERT_COUNTRY, CERT_PASSWORD, CERT_PASSWORD_FILE, CERT_OUT, CERT_CA_DIR

If Samsung ends the login on a page instead of redirecting back, paste that
page's URL as CALLBACK_URL=... and run again.
`);
  process.exit(0);
}

const HOME = process.env.HOME || process.env.USERPROFILE;
const PROFILE = arg("profile", process.env.CERT_PROFILE || "Tizen");
const OUT = arg("out", process.env.CERT_OUT ||
  path.join(HOME, "tizen-studio-data", "SamsungCertificate", PROFILE));
const CA_DIR = arg("ca", process.env.CERT_CA_DIR ||
  path.join(HOME, "tizen-studio-data", "samsung-ca"));

const DUID = arg("duid", process.env.TV_DUID);
if (!DUID) {
  console.error("Missing --duid.\n");
  console.error("On the TV: Apps > press 1 2 3 4 5 > Developer Mode panel shows the DUID.");
  console.error("Then:  npx samsung-tv-cert --duid <DUID>");
  console.error("Run with --help for everything else.");
  process.exit(1);
}

/* The CA certificates that go into the p12 chains ship with Tizen Studio. There
 * is no public download for them on their own, so this fails early and says
 * where they come from rather than throwing a PEM parse error six steps later. */
const AUTHOR_CA = path.join(CA_DIR, "vd_tizen_dev_author_ca.cer");
const DIST_CA = path.join(CA_DIR, "vd_tizen_dev_public2.crt");
for (const f of [AUTHOR_CA, DIST_CA]) {
  if (!fs.existsSync(f)) {
    console.error("Missing CA certificate: " + f + "\n");
    console.error("These ship inside Tizen Studio, in tizen-studio-data/samsung-ca/.");
    console.error("Install the Tizen Studio CLI (the IDE is not needed) and they appear:");
    console.error("  https://developer.tizen.org/development/tizen-studio/download");
    console.error("Already have them elsewhere?  --ca /path/to/samsung-ca");
    process.exit(1);
  }
}

/* Protects the private keys that sign every build you ever make. Generated when
 * unset rather than defaulted to a literal — a shared default password is no
 * password at all. */
const PW_FILE = arg("password-file", process.env.CERT_PASSWORD_FILE ||
  path.join(HOME, ".samsung-tv-cert-password"));
let PASSWORD = arg("password", process.env.CERT_PASSWORD);
if (!PASSWORD && fs.existsSync(PW_FILE)) PASSWORD = fs.readFileSync(PW_FILE, "utf8").trim();
let generatedPassword = false;
if (!PASSWORD) {
  PASSWORD = crypto.randomBytes(18).toString("base64url");
  fs.writeFileSync(PW_FILE, PASSWORD + "\n", { mode: 0o600 });
  generatedPassword = true;
}

const AUTHOR_NAME = arg("name", process.env.CERT_NAME || "Tizen Developer");
const AUTHOR_ORG = arg("org", process.env.CERT_ORG || "Independent");
const AUTHOR_CITY = arg("city", process.env.CERT_CITY || "Unknown");
const AUTHOR_STATE = arg("state", process.env.CERT_STATE || "Unknown");
const AUTHOR_COUNTRY = arg("country", process.env.CERT_COUNTRY || "US");

const PRIVILEGE = "Public";
const AUTHOR_URL = "https://svdca.samsungqbe.com/apis/v3/authors";
const DIST_URL_V3 = "https://svdca.samsungqbe.com/apis/v3/distributors";
const DIST_URL_V1 = "https://svdca.samsungqbe.com/apis/v1/distributors";
const LOGIN_URL =
  "https://account.samsung.com/mobile/account/check.do?serviceID=v285zxnl3h" +
  "&actionID=StartOAuth2&accessToken=Y&redirect_uri=http://localhost:4794/signin/callback";

fs.mkdirSync(OUT, { recursive: true });
function log(...a) { console.log("[cert]", ...a); }
if (generatedPassword) log("generated a certificate password ->", PW_FILE, "(mode 600)");

/* ---------------- step 1: OAuth callback capture ---------------- */

/* Kept for the case where Samsung hands back a real authorization code.
 * The endpoint answers with an HTML page whose <body> holds a query string. */
function exchangeCode(code) {
  const url = "https://api.samsungosp.com/v2/license/security/authorizeToken?authToken=" +
              encodeURIComponent(code);
  log("exchanging authorization code for access token...");
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const m = text.match(/<body>([\s\S]*?)<\/body>/i);
        const body = (m ? m[1] : text).trim();
        const pick = (k) => {
          const i = body.indexOf(k + "=");
          if (i < 0) return null;
          const rest = body.slice(i + k.length + 1);
          const amp = rest.indexOf("&");
          return (amp < 0 ? rest : rest.slice(0, amp)).trim();
        };
        const token = pick("access_token");
        const userId = pick("userId");
        const email = (pick("inputEmailID") || "").replace(/%40/g, "@");
        if (!token || !userId) {
          return reject(new Error("token exchange failed (HTTP " + res.statusCode + "): " +
                                  body.slice(0, 300)));
        }
        resolve({ token, userId, email });
      });
    }).on("error", reject);
  });
}

function awaitLogin() {
  if (process.env.TOKEN_JSON) {
    const j = JSON.parse(process.env.TOKEN_JSON);
    log("using TOKEN_JSON from a callback already captured");
    return Promise.resolve({ token: j.access_token, userId: j.userId, email: j.inputEmailID || "" });
  }
  if (process.env.CALLBACK_URL) {
    const q = new URL(process.env.CALLBACK_URL.replace(/^.*?\?/, "http://x/?"));
    const token = q.searchParams.get("access_token");
    const userId = q.searchParams.get("userId") || q.searchParams.get("user_id");
    const email = q.searchParams.get("inputEmailID") || q.searchParams.get("email") || "";
    if (token && userId) { log("using pasted CALLBACK_URL"); return Promise.resolve({ token, userId, email }); }
    return Promise.reject(new Error("CALLBACK_URL has no access_token/userId"));
  }
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://localhost:4794");
      const ok = "<html><body style='font:20px sans-serif;padding:60px'>" +
                 "<h2>&#10003; Samsung login captured</h2>" +
                 "<p>You can close this tab. The terminal takes it from here.</p></body></html>";
      const collect = (params) => {
        const code = params.get("code");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        /* `code` is NOT an authorization code, whatever the parameter name says:
         * Samsung packs the entire token payload into it as JSON. Sending it to
         * the OSP exchange endpoint returns `403 ACF_0403 [AllowList]` from any
         * ordinary network, which reads like a permissions problem and is in
         * fact the wrong road entirely. Parse it and move on. */
        if (code && code.trim().startsWith("{")) {
          const j = JSON.parse(code);
          res.end(ok);
          server.close();
          resolve({ token: j.access_token, userId: j.userId, email: j.inputEmailID || "" });
        } else if (code) {
          res.end(ok);
          server.close();
          exchangeCode(code).then(resolve, reject);
        } else {
          res.end("<html><body style='font:20px sans-serif;padding:60px'>" +
                  "<h2>No code in callback</h2><pre>" + u.search + "</pre></body></html>");
        }
      };
      if (req.method === "POST") {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => collect(new URLSearchParams(body)));
      } else {
        collect(u.searchParams);
      }
    });
    server.on("error", (e) => {
      if (e.code === "EADDRINUSE") {
        return reject(new Error("port 4794 is busy — Samsung only redirects there, " +
                                "so close whatever holds it and retry"));
      }
      reject(e);
    });
    server.listen(4794, "127.0.0.1", () => {
      console.log("\n==================== ACTION NEEDED ====================");
      console.log("Sign in with your Samsung account in the browser window that");
      console.log("just opened. If it did not open, use this URL:\n");
      console.log(LOGIN_URL);
      console.log("\n(Your password goes straight to Samsung. This process only");
      console.log(" receives the OAuth callback.)");
      console.log("=======================================================\n");
      const opener = process.platform === "darwin" ? "open"
                   : process.platform === "win32" ? "start" : "xdg-open";
      execFile(opener, [LOGIN_URL], () => {});
    });
    setTimeout(() => { server.close(); reject(new Error("login timed out after 15 min")); },
               15 * 60 * 1000);
  });
}

/* ---------------- step 2: CSR generation ---------------- */

function writeCsr(kind, subject, altNames) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject(subject);
  if (altNames) {
    csr.setAttributes([{ name: "extensionRequest", extensions: [{ name: "subjectAltName", altNames }] }]);
  }
  csr.sign(keys.privateKey);
  fs.writeFileSync(path.join(OUT, kind + ".pri"), forge.pki.privateKeyToPem(keys.privateKey),
                   { mode: 0o600 });
  const pem = forge.pki.certificationRequestToPem(csr);
  fs.writeFileSync(path.join(OUT, kind + ".csr"), pem);
  log(kind + ".csr written");
  return pem;
}

/* ---------------- step 3: multipart POST ---------------- */

function postMultipart(url, fields, csrPem, csrName) {
  return new Promise((resolve, reject) => {
    const B = "*****";
    let body = "";
    for (const [k, v] of Object.entries(fields)) {
      body += `--${B}\r\nContent-Disposition: form-data; name=${k}\r\n` +
              `Content-Type: text/plain; charset=utf-8\r\n\r\n${v}\r\n`;
    }
    body += `--${B}\r\nContent-Disposition: form-data; name=csr; filename=${csrName}\r\n` +
            `Content-Type: text/plain; charset=utf-8\r\n\r\n${csrPem}\r\n--${B}--\r\n`;
    const buf = Buffer.from(body, "utf8");
    const u = new URL(url);
    const req = https.request({
      host: u.host, path: u.pathname, method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary="${B}"`,
        "Content-Length": buf.length,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode !== 200) {
          return reject(new Error(`${url} -> HTTP ${res.statusCode}: ${text.slice(0, 400)}`));
        }
        if (text.trim().startsWith("{")) {
          try {
            const j = JSON.parse(text);
            if (j.error || j.status === "FAIL" || j.code) {
              return reject(new Error(`${url} -> ${text.slice(0, 400)}`));
            }
          } catch { /* not json after all */ }
        }
        resolve(text);
      });
    });
    req.on("error", reject);
    req.end(buf);
  });
}

/* ---------------- step 4: PKCS#12 assembly ---------------- */

function firstCertPem(text) {
  const b = text.indexOf("-----BEGIN CERTIFICATE-----");
  const e = text.indexOf("-----END CERTIFICATE-----");
  if (b < 0 || e < 0) throw new Error("no PEM certificate in response: " + text.slice(0, 300));
  return text.slice(b, e + "-----END CERTIFICATE-----".length);
}

function buildP12(kind, crtText, caFile) {
  const leaf = forge.pki.certificateFromPem(firstCertPem(crtText));
  const ca = forge.pki.certificateFromPem(firstCertPem(fs.readFileSync(caFile, "utf8")));
  const key = forge.pki.privateKeyFromPem(fs.readFileSync(path.join(OUT, kind + ".pri"), "utf8"));
  const asn1 = forge.pkcs12.toPkcs12Asn1(key, [leaf, ca], PASSWORD,
    { generateLocalKeyId: true, friendlyName: "UserCertificate" });
  const der = forge.asn1.toDer(asn1).getBytes();
  const p12Path = path.join(OUT, kind + ".p12");
  fs.writeFileSync(p12Path, der, { encoding: "binary", mode: 0o600 });
  log(kind + ".p12 written ->", p12Path);
  return p12Path;
}

/* ---------------- main ---------------- */

const { token, userId, email } = await awaitLogin();
log("signed in as", email || userId);

const authorCsr = writeCsr("author", [
  { name: "commonName", value: AUTHOR_NAME },
  { name: "organizationName", value: AUTHOR_ORG },
  { name: "localityName", value: AUTHOR_CITY },
  { shortName: "ST", value: AUTHOR_STATE },
  { name: "countryName", value: AUTHOR_COUNTRY },
]);

const distCsr = writeCsr("distributor",
  [{ name: "commonName", value: "TizenSDK" },
   { name: "emailAddress", value: email || process.env.CERT_EMAIL || "tizen@example.com" }],
  [{ type: 6, value: "URN:tizen:packageid=" }, { type: 6, value: "URN:tizen:deviceid=" + DUID }]);

log("requesting author certificate...");
const authorCrt = await postMultipart(AUTHOR_URL,
  { access_token: token, user_id: userId, platform: "VD" }, authorCsr, "author.csr");
fs.writeFileSync(path.join(OUT, "author.crt"), authorCrt);
log("author certificate issued");

log("requesting distributor certificate for DUID", DUID, "...");
const distFields = {
  access_token: token, user_id: userId, privilege_level: PRIVILEGE,
  developer_type: "Individual", platform: "VD",
};
const distCrt = await postMultipart(DIST_URL_V3, distFields, distCsr, "distributor.csr");
fs.writeFileSync(path.join(OUT, "distributor.crt"), distCrt);
log("distributor certificate issued");

/* Optional. Tizen Studio writes one; nothing in the signing path reads it. */
try {
  const xml = await postMultipart(DIST_URL_V1, distFields, distCsr, "distributor.csr");
  fs.writeFileSync(path.join(OUT, "device-profile.xml"), xml);
  log("device-profile.xml saved");
} catch (e) { log("device-profile.xml skipped:", e.message.slice(0, 120)); }

const authorP12 = buildP12("author", authorCrt, AUTHOR_CA);
const distP12 = buildP12("distributor", distCrt, DIST_CA);

console.log(`
Done.

  author.p12       ${authorP12}
  distributor.p12  ${distP12}
  password         ${PW_FILE}

Register them as a signing profile, then package:

  tizen security-profiles add -n MyProfile -A \\
    -a "${authorP12}" -p "$(cat ${PW_FILE})" \\
    -d "${distP12}" -dp "$(cat ${PW_FILE})" \\
    -dc "${DIST_CA}" \\
    -c "${AUTHOR_CA}"
  tizen package -t wgt -s MyProfile -- .

The distributor certificate is bound to DUID ${DUID}. It will not install on any
other television.
`);
