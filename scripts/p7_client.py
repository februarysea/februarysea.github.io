"""Narrow PETSEE history client. Secrets are read from the environment only.

Uses the request signing already verified in the local P7 access project.
There are no login, control, binding, deletion, or firmware-update methods here.
"""
import datetime as dt
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from zoneinfo import ZoneInfo

ACTION = "smartlife.m.smart.operate.all.log"
SIGN_FIELDS = frozenset(("a", "v", "lat", "lon", "lang", "deviceId", "appVersion", "ttid", "isH5", "h5Token", "os", "clientId", "postData", "time", "requestId", "et", "n4h5", "sid", "chKey", "sp"))


class P7ClientError(RuntimeError):
    pass


class P7AuthExpired(P7ClientError):
    pass


class P7TransientError(P7ClientError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def send(endpoint, params):
    request = urllib.request.Request(endpoint, data=urllib.parse.urlencode(params).encode(),
                                     headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=15) as response:
            payload = response.read(4 * 1024 * 1024 + 1)
            if len(payload) > 4 * 1024 * 1024:
                raise P7ClientError("P7 response exceeded the size limit.")
            return json.loads(payload)
    except urllib.error.HTTPError as error:
        if error.code in (429, 500, 502, 503, 504):
            raise P7TransientError("P7 temporarily unavailable.") from None
        raise P7ClientError("P7 HTTP request failed.") from None
    except (urllib.error.URLError, TimeoutError):
        raise P7TransientError("P7 connection failed.") from None


class P7Client:
    def __init__(self, profile, session, device_id, transport=send, sleep=time.sleep):
        fields = ("package_name", "certificate_sha256", "bmp_component", "app_secret", "app_version", "sdk_version", "client_id", "install_id", "ttid", "ch_key")
        if (not isinstance(profile, dict) or profile.get("package_name") != "com.petsee"
                or profile.get("signing_mode") != "pkg_cert_bmp_secret"
                or any(not isinstance(profile.get(key), str) or not profile[key] for key in fields)
                or not isinstance(session, dict) or not isinstance(session.get("sid"), str) or not session["sid"]
                or not isinstance(device_id, str) or not device_id):
            raise P7ClientError("P7 credential configuration is incomplete.")
        host = (session.get("domain") or {}).get("mobileApiUrl") or "https://a1.tuyacn.com"
        parsed = urllib.parse.urlsplit(host if "://" in host else "https://" + host)
        if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443)
                or not any((parsed.hostname or "").endswith("." + root) for root in
                           ("tuyacn.com", "tuyaus.com", "tuyaeu.com", "tuyain.com", "iotbing.com"))):
            raise P7ClientError("Unexpected P7 API destination.")
        self.endpoint = "https://" + parsed.netloc + "/api.json"
        self.profile, self.session, self.device_id = profile, session, device_id
        self.transport, self.sleep = transport, sleep

    @classmethod
    def from_environment(cls):
        try:
            return cls(json.loads(os.environ["P7_APP_PROFILE_JSON"]), json.loads(os.environ["P7_SESSION_JSON"]), os.environ["P7_DEVICE_ID"])
        except (KeyError, ValueError, TypeError):
            raise P7ClientError("Configure P7_APP_PROFILE_JSON, P7_SESSION_JSON and P7_DEVICE_ID.") from None

    def page(self, query):
        if (set(query) != {"devId", "dpIds", "offset", "limit", "startTime", "endTime", "sortType"}
                or query["devId"] != self.device_id or query["dpIds"] != "107,109"
                or query["sortType"] != "ASC" or query["limit"] != 100):
            raise P7ClientError("Only this P7's weight/duration history may be queried.")
        c = self.profile
        for attempt in range(3):
            params = {
                "a": ACTION, "v": "1.0", "lang": "zh", "os": "Android",
                "appVersion": c["app_version"], "sdkVersion": c["sdk_version"],
                "clientId": c["client_id"], "deviceId": c["install_id"], "ttid": c["ttid"],
                "chKey": c["ch_key"], "et": "0.0.1", "time": str(int(time.time())),
                "requestId": str(uuid.uuid4()), "timeZoneId": "Asia/Shanghai", "sid": self.session["sid"], "sp": "1",
                "postData": json.dumps(query, separators=(",", ":"), ensure_ascii=False),
            }
            fields = {key: value for key, value in params.items() if key in SIGN_FIELDS and value != ""}
            digest = hashlib.md5(fields["postData"].encode()).hexdigest()
            fields["postData"] = digest[8:16] + digest[:8] + digest[24:32] + digest[16:24]
            canonical = "||".join(key + "=" + fields[key] for key in sorted(fields))
            key = "_".join((c["package_name"], c["certificate_sha256"], c["bmp_component"], c["app_secret"])).encode()
            params["sign"] = hmac.new(key, canonical.encode(), hashlib.sha256).hexdigest()
            try:
                result = self.transport(self.endpoint, params)
            except P7TransientError:
                if attempt == 2:
                    raise
                self.sleep(2 ** attempt)
                continue
            if not isinstance(result, dict):
                raise P7ClientError("Invalid P7 response shape.")
            if result.get("success") is not True:
                if result.get("errorCode") == "USER_SESSION_INVALID":
                    raise P7AuthExpired("P7 authorization expired.")
                raise P7ClientError("P7 rejected the read request.")
            return result

    def history(self, now=None):
        now = now or dt.datetime.now(dt.timezone.utc)
        zone = ZoneInfo("Asia/Shanghai")
        start = dt.datetime.combine(now.astimezone(zone).date() - dt.timedelta(days=6), dt.time(), zone)
        rows, expected, retrieved = [], None, None
        for _ in range(50):
            result = self.page({"devId": self.device_id, "dpIds": "107,109", "offset": len(rows), "limit": 100,
                                "startTime": str(int(start.timestamp() * 1000)), "endTime": str(int(now.timestamp() * 1000)), "sortType": "ASC"})
            page = result.get("result")
            if (not isinstance(page, dict) or not isinstance(page.get("dps"), list)
                    or type(page.get("total")) is not int or type(page.get("hasNext")) is not bool
                    or type(result.get("t")) not in (int, float)):
                raise P7ClientError("Invalid P7 history page.")
            if expected is not None and page["total"] != expected:
                raise P7ClientError("P7 history changed during pagination; retry later.")
            expected, retrieved = page["total"], result["t"]
            rows.extend(page["dps"])
            if len(rows) > expected or page["hasNext"] and len(rows) >= expected:
                raise P7ClientError("P7 pagination count is inconsistent.")
            if not page["hasNext"]:
                if len(rows) != expected:
                    raise P7ClientError("P7 history is incomplete.")
                return {"success": True, "t": retrieved, "result": {"dps": rows, "total": len(rows), "hasNext": False}}
            if not page["dps"]:
                raise P7ClientError("P7 pagination made no progress.")
        raise P7ClientError("P7 pagination limit reached.")
