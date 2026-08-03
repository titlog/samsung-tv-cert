# samsung-tv-cert

Issue Samsung TV **author + distributor certificates** from the command line.

```bash
npx samsung-tv-cert --duid <YOUR-TV-DUID>
```

No Eclipse. No Certificate Manager GUI. No sudo. One command, a browser login,
two `.p12` files ready to sign with.

---

## Why this exists

Sideloading anything onto a modern Samsung TV — Jellyfin, a Twitch client, your
own app — needs a **Samsung-issued distribution certificate**.

Tizen's own bundled distributor certificates **do not work** on 2023+ sets. Both
of them fail identically:

| Certificate | Result |
|---|---|
| `tizen-distributor-signer` (expired 2022) | `Invalid certificate chain` |
| `tizen-distributor-signer-new` (valid to 2032) | `Invalid certificate chain` |

Same error for the expired pair and the one valid for another six years — so it
is a **trust-chain** problem, not an expiry one. There is no way around it: the
television only trusts certificates Samsung issued.

The documented route is Tizen Studio's **Certificate Manager**, a GUI inside an
Eclipse distribution. That is a very large installation to click four buttons,
and it cannot be scripted, containerised, or run on a headless box.

This tool does the same thing the GUI does, against the same endpoints:

```
login    account.samsung.com OAuth2  ->  http://localhost:4794/signin/callback
author   POST svdca.samsungqbe.com/apis/v3/authors
distrib  POST svdca.samsungqbe.com/apis/v3/distributors   (+ v1 for the xml)
```

Your Samsung password goes to Samsung, in your own browser. Only the OAuth
callback reaches this process.

## Requirements

- **Node 18+**
- **The Tizen Studio CLI**, for two CA certificates that ship inside it
  (`tizen-studio-data/samsung-ca/`). The IDE is not needed.
  [Download](https://developer.tizen.org/development/tizen-studio/download)
- **A free Samsung account**
- **Your TV's DUID** — on the TV: `Apps`, press `1 2 3 4 5`, read it off the
  Developer Mode panel

> Already have the CA certificates somewhere else? `--ca /path/to/samsung-ca`.

## Usage

```bash
npx samsung-tv-cert --duid ABCDEFGH12345
```

A browser opens, you sign in, the terminal takes it from there:

```
[cert] generated a certificate password -> ~/.samsung-tv-cert-password (mode 600)
[cert] signed in as you@example.com
[cert] author.csr written
[cert] distributor.csr written
[cert] requesting author certificate...
[cert] author certificate issued
[cert] requesting distributor certificate for DUID ABCDEFGH12345 ...
[cert] distributor certificate issued
[cert] author.p12 written -> ~/tizen-studio-data/SamsungCertificate/Tizen/author.p12
[cert] distributor.p12 written -> ~/tizen-studio-data/SamsungCertificate/Tizen/distributor.p12
```

Then register and package:

```bash
tizen security-profiles add -n MyProfile -A \
  -a ~/tizen-studio-data/SamsungCertificate/Tizen/author.p12 -p "$(cat ~/.samsung-tv-cert-password)" \
  -d ~/tizen-studio-data/SamsungCertificate/Tizen/distributor.p12 -dp "$(cat ~/.samsung-tv-cert-password)" \
  -dc ~/tizen-studio-data/samsung-ca/vd_tizen_dev_public2.crt \
  -c  ~/tizen-studio-data/samsung-ca/vd_tizen_dev_author_ca.cer
tizen package -t wgt -s MyProfile -- .
```

The exact command, with your paths filled in, is printed when the tool finishes.

### Options

```
--duid <id>            required. binds the distributor certificate to one TV
--profile <name>       output folder name          (default: Tizen)
--name / --org         author certificate identity (default: anonymous)
--city / --state / --country
--password <str>       p12 password. generated and saved to a 600 file if omitted
--password-file <p>    where that password lives   (default: ~/.samsung-tv-cert-password)
--out <dir>            output directory
--ca <dir>             Samsung CA certificates     (default: ~/tizen-studio-data/samsung-ca)
--help
```

Every option has an environment equivalent: `TV_DUID`, `CERT_PROFILE`,
`CERT_NAME`, `CERT_ORG`, `CERT_CITY`, `CERT_STATE`, `CERT_COUNTRY`,
`CERT_PASSWORD`, `CERT_PASSWORD_FILE`, `CERT_OUT`, `CERT_CA_DIR`.

## Things that cost a day to find out

**The `code` parameter in the OAuth callback is not an authorization code.**
Samsung packs the entire token payload into it as JSON. Sending it to
`api.samsungosp.com/v2/license/security/authorizeToken` — which is what the name
tells you to do — returns `403 ACF_0403 [AllowList]` from any ordinary network.
That reads like a permissions problem, or a geo-block, or an account tier you do
not have. It is none of those: it is simply the wrong road. Parse the JSON.

**The distributor certificate is bound to a DUID.** A wrong one signs perfectly
and produces a `.wgt` that installs on nothing, with an error that does not
mention the DUID.

**Port 4794 is not negotiable.** Samsung redirects there and nowhere else. If
something else holds it, the login cannot complete.

**Tizen's own distributor certificates are a dead end**, both of them, on modern
sets. Do not spend an evening deciding which one to try next.

## Prior art

The mechanics were read out of `org.tizen.common.cert` inside Tizen Studio.
This tool exists because that logic was locked inside a GUI.

Built while writing a [bilibili client for Samsung TVs](https://github.com/titlog/bilibili-tizen),
where the certificate step was the single largest obstacle to anyone else being
able to install it.

## Licence

MIT. Not affiliated with Samsung. Uses Samsung's own developer certificate
service exactly as Tizen Studio does.
