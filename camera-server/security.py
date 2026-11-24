"""Authentication helpers and the self-signed HTTPS certificate."""
from __future__ import annotations

import datetime as dt
import hmac
import ipaddress
import secrets
import socket
import time
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import urlparse

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


def tokens_equal(supplied: object, expected: str) -> bool:
    """Constant-time comparison, so response timing can't leak the token."""
    if not isinstance(supplied, str) or not supplied or len(supplied) > 256:
        return False
    return hmac.compare_digest(supplied.encode(), expected.encode())


class AuthLimiter:
    """Blocks an address for a while after too many failed logins."""

    def __init__(self, max_failures: int = 8, window: float = 60.0, clock=time.monotonic):
        self.max_failures = max_failures
        self.window = window
        self._clock = clock
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, ip: str) -> deque[float]:
        events = self._failures[ip]
        cutoff = self._clock() - self.window
        while events and events[0] < cutoff:
            events.popleft()
        return events

    def blocked(self, ip: str) -> bool:
        return len(self._prune(ip)) >= self.max_failures

    def record_failure(self, ip: str) -> None:
        self._prune(ip).append(self._clock())

    def reset(self, ip: str) -> None:
        self._failures.pop(ip, None)


class TicketStore:
    """Short random tickets that let an <img> tag load the MJPEG stream.

    An <img> can't send an Authorization header, so after a viewer proves it
    knows the viewer token over the WebSocket, the server hands it a ticket
    to put in the stream URL instead of the token itself.
    """

    def __init__(self, ttl: float = 12 * 3600, clock=time.monotonic):
        self.ttl = ttl
        self._clock = clock
        self._tickets: dict[str, float] = {}

    def issue(self) -> str:
        now = self._clock()
        self._tickets = {t: exp for t, exp in self._tickets.items() if exp > now}
        ticket = secrets.token_urlsafe(18)
        self._tickets[ticket] = now + self.ttl
        return ticket

    def valid(self, ticket: str | None) -> bool:
        if not ticket:
            return False
        expires = self._tickets.get(ticket)
        return expires is not None and expires > self._clock()


def origin_allowed(origin: str | None, host_header: str | None, allowed: tuple[str, ...]) -> bool:
    """Browsers always send Origin on WebSocket handshakes; refuse unknown sites.

    A missing Origin means a non-browser client (a script), which still has
    to present a valid token, so it is let through to the token check.
    """
    if not origin:
        return True
    if origin in allowed:
        return True
    return bool(host_header) and urlparse(origin).netloc == host_header


# --------------------------------------------------------------------------
# Self-signed HTTPS certificate
# --------------------------------------------------------------------------
def lan_addresses() -> list[str]:
    """This computer's LAN IPv4 addresses, the one a phone on the same Wi-Fi should use first.

    The first entry is the address of the network the computer actually uses to reach the
    internet (normally the Wi-Fi). Virtual adapters (WSL, Docker, Hyper-V, VirtualBox, VPNs)
    come after it: the computer can reach them itself, but a phone usually can't."""
    primary = None
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))  # picks the outgoing interface; no packet is actually sent
        primary = probe.getsockname()[0]
        probe.close()
    except OSError:
        pass
    others: set[str] = set()
    try:
        for addr in socket.gethostbyname_ex(socket.gethostname())[2]:
            others.add(addr)
    except OSError:
        pass
    usable = lambda a: a and not a.startswith(("127.", "169.254."))
    ordered = [primary] if usable(primary) else []
    ordered += sorted(a for a in others if usable(a) and a != primary)
    return ordered


def _san_entries(names: list[str]) -> list[x509.GeneralName]:
    entries: list[x509.GeneralName] = []
    for name in names:
        try:
            entries.append(x509.IPAddress(ipaddress.ip_address(name)))
        except ValueError:
            entries.append(x509.DNSName(name))
    return entries


def _cert_is_usable(cert_path: Path, key_path: Path, names: list[str]) -> bool:
    if not (cert_path.exists() and key_path.exists()):
        return False
    try:
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    except (ValueError, x509.ExtensionNotFound):
        return False
    expires = cert.not_valid_after_utc
    if expires - dt.datetime.now(dt.timezone.utc) < dt.timedelta(days=30):
        return False
    have = {str(ip) for ip in san.get_values_for_type(x509.IPAddress)} | set(
        san.get_values_for_type(x509.DNSName)
    )
    return all(name in have for name in names)


def ensure_certificate(cert_dir: Path, extra_names: tuple[str, ...] = ()) -> tuple[Path, Path]:
    """Create (or reuse) a self-signed certificate valid for this machine's addresses."""
    cert_dir.mkdir(parents=True, exist_ok=True)
    cert_path, key_path = cert_dir / "cert.pem", cert_dir / "key.pem"
    names = ["localhost", "127.0.0.1", *lan_addresses(), *extra_names]
    names = list(dict.fromkeys(names))
    if _cert_is_usable(cert_path, key_path, names):
        return cert_path, key_path

    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "HighLo Camera Server")])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName(_san_entries(names)), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .sign(key, hashes.SHA256())
    )
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    try:
        key_path.chmod(0o600)
    except OSError:
        pass
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return cert_path, key_path
