# samsung-tv-cert

**[English](#english) · [中文](#中文)**

Issue Samsung TV **author + distributor certificates** from the command line.

```bash
npx samsung-tv-cert --duid <YOUR-TV-DUID>
```

No Eclipse. No Certificate Manager GUI. No sudo. One command, a browser login,
two `.p12` files ready to sign with.

---

## English

### Why this exists

Sideloading anything onto a modern Samsung TV — Jellyfin, a Twitch client, your
own app — needs a **Samsung-issued distribution certificate**.

Tizen's own bundled distributor certificates **do not work** on 2023+ sets. Both
of them fail identically:

| Certificate | Result |
|---|---|
| `tizen-distributor-signer` (expired 2022) | `Invalid certificate chain` |
| `tizen-distributor-signer-new` (valid to 2032) | `Invalid certificate chain` |

Same error for the expired pair and for the one valid another six years — so it
is a **trust-chain** problem, not an expiry one. There is no way around it: the
television only trusts certificates Samsung issued.

The documented route is Tizen Studio's **Certificate Manager**, a GUI inside an
Eclipse distribution. That is a very large installation to click four buttons,
and it cannot be scripted, containerised, or run on a headless box.

This tool does what that GUI does, against the same endpoints:

```
login    account.samsung.com OAuth2  ->  http://localhost:4794/signin/callback
author   POST svdca.samsungqbe.com/apis/v3/authors
distrib  POST svdca.samsungqbe.com/apis/v3/distributors   (+ v1 for the xml)
```

Your Samsung password goes to Samsung, in your own browser. Only the OAuth
callback reaches this process.

### Requirements

- **Node 18+**
- **The Tizen Studio CLI**, for two CA certificates that ship inside it
  (`tizen-studio-data/samsung-ca/`). The IDE is not needed.
  [Download](https://developer.tizen.org/development/tizen-studio/download)
- **A free Samsung account**
- **Your TV's DUID** — on the TV: `Apps`, press `1 2 3 4 5`, read it off the
  Developer Mode panel

> Already have the CA certificates elsewhere? `--ca /path/to/samsung-ca`.

### Usage

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

### Things that cost a day to find out

**The `code` parameter in the OAuth callback is not an authorization code.**
Samsung packs the entire token payload into it as JSON. Sending it to
`api.samsungosp.com/v2/license/security/authorizeToken` — which is what the name
tells you to do — returns `403 ACF_0403 [AllowList]` from any ordinary network.
That reads like a permissions problem, or a geo-block, or an account tier you do
not have. It is none of those: it is simply the wrong road. Parse the JSON.

**The distributor certificate is bound to a DUID.** A wrong one signs perfectly
and produces a `.wgt` that installs on nothing, with an error that never
mentions the DUID.

**Port 4794 is not negotiable.** Samsung redirects there and nowhere else. If
something else holds it, the login cannot complete.

**Tizen's own distributor certificates are a dead end**, both of them, on modern
sets. Do not spend an evening deciding which to try next.

### Prior art

The mechanics were read out of `org.tizen.common.cert` inside Tizen Studio.
This tool exists because that logic was locked inside a GUI.

Built while writing a [bilibili client for Samsung TVs](https://github.com/titlog/bilibili-tizen),
where the certificate step was the single largest obstacle to anyone else being
able to install it.

### Licence

MIT. Not affiliated with Samsung. Uses Samsung's own developer certificate
service exactly as Tizen Studio does.

---

## 中文

### 这个工具解决什么

想把任何东西侧载到较新的三星电视上 —— Jellyfin、Twitch 社区版、或者你自己写的应用
—— 都需要一张**三星签发的分发证书**。

Tizen 自带的两套分发证书在 2023 年以后的机器上**都不能用**,而且报错一模一样:

| 证书 | 结果 |
|---|---|
| `tizen-distributor-signer`(2022 年过期) | `Invalid certificate chain` |
| `tizen-distributor-signer-new`(有效期到 2032) | `Invalid certificate chain` |

过期的那套和还有六年有效期的那套报同一个错 —— 所以这是**信任链**问题,不是过期问题,
绕不过去:电视只信任三星签发的证书。

官方唯一的路是 Tizen Studio 的**证书管理器**,一个装在 Eclipse 发行版里的图形界面。
为了点四下按钮装几个 G,而且不能脚本化、不能进容器、不能在无头机器上跑。

这个工具做的是同一件事,打的是同一批端点:

```
登录    account.samsung.com OAuth2  ->  http://localhost:4794/signin/callback
author  POST svdca.samsungqbe.com/apis/v3/authors
分发    POST svdca.samsungqbe.com/apis/v3/distributors   （xml 另走 v1）
```

**你的三星密码只发给三星,在你自己的浏览器里。** 这个进程只拿到 OAuth 回调。

### 需要准备

- **Node 18+**
- **Tizen Studio 的命令行工具** —— 只为了它里面自带的两张 CA 证书
  (`tizen-studio-data/samsung-ca/`)。**不需要装 IDE**。
  [下载](https://developer.tizen.org/development/tizen-studio/download)
- **一个免费的三星账号**
- **电视的 DUID** —— 电视上:`Apps` 页面,遥控器按 `1 2 3 4 5`,开发者模式面板里显示

> CA 证书已经在别处?用 `--ca /path/to/samsung-ca` 指过去。

### 用法

```bash
npx samsung-tv-cert --duid ABCDEFGH12345
```

浏览器会自动打开,登录三星账号,剩下的交给终端。跑完会**把填好路径的下一步命令直接
打出来**:

```bash
tizen security-profiles add -n MyProfile -A \
  -a <author.p12> -p "$(cat ~/.samsung-tv-cert-password)" \
  -d <distributor.p12> -dp "$(cat ~/.samsung-tv-cert-password)" \
  -dc <vd_tizen_dev_public2.crt> \
  -c  <vd_tizen_dev_author_ca.cer>
tizen package -t wgt -s MyProfile -- .
```

### 参数

```
--duid <id>            必填。分发证书会绑定到这一台电视
--profile <name>       输出目录名                  （默认 Tizen）
--name / --org         作者证书里的身份            （默认匿名）
--city / --state / --country
--password <str>       p12 密码。不给就随机生成并存进 600 权限的文件
--password-file <p>    密码文件位置                （默认 ~/.samsung-tv-cert-password）
--out <dir>            输出目录
--ca <dir>             三星 CA 证书目录            （默认 ~/tizen-studio-data/samsung-ca）
--help
```

每个参数都有对应的环境变量:`TV_DUID`、`CERT_PROFILE`、`CERT_NAME`、`CERT_ORG`、
`CERT_CITY`、`CERT_STATE`、`CERT_COUNTRY`、`CERT_PASSWORD`、`CERT_PASSWORD_FILE`、
`CERT_OUT`、`CERT_CA_DIR`。

### 几条只能靠撞才知道的事

**OAuth 回调里的 `code` 参数不是授权码。** 三星把整个 token 载荷以 JSON 塞进了它。
按名字理解、拿去 `api.samsungosp.com/v2/license/security/authorizeToken` 换取,会从
任何普通网络得到 `403 ACF_0403 [AllowList]` —— 读起来像权限问题、像地区封锁、像
账号等级不够。**都不是,只是走错了路。** 直接解析那段 JSON 就行。

**分发证书绑 DUID。** 填错了照样签得出来,产出的 `.wgt` 装不上任何机器,而报错里
**根本不提 DUID**。

**端口 4794 不可协商。** 三星只往那里跳。被别的进程占着,登录就完不成。

**Tizen 自带的两套分发证书是死路**,在新机器上都一样。别花一晚上纠结先试哪一套。

### 来源

实现细节是从 Tizen Studio 里的 `org.tizen.common.cert` 读出来的。这个工具存在的
理由,就是那套逻辑被锁在了一个图形界面里。

写[三星电视上的 bilibili 客户端](https://github.com/titlog/bilibili-tizen)时顺手做的
—— 证书这一步是别人想装上它的最大障碍。

### 协议

MIT。与三星无关联。使用的是三星自己的开发者证书服务,方式和 Tizen Studio 完全一致。
