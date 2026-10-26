"""Start the HighLo camera server:  python main.py"""
from __future__ import annotations

import logging

import uvicorn

from app import create_app
from config import load_settings
from security import ensure_certificate, lan_addresses


def print_qr(url: str) -> None:
    try:
        import qrcode

        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.make(fit=True)
        qr.print_ascii(invert=True)
    except Exception:  # missing package or a terminal that can't show the blocks
        pass


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s")
    settings = load_settings()

    scheme = "https" if settings.tls else "http"
    addresses = lan_addresses() or ["localhost"]
    base = f"{scheme}://{addresses[0]}:{settings.port}"
    phone_url = f"{base}/camera#t={settings.phone_token}"

    ssl_args = {}
    if settings.tls:
        cert, key = ensure_certificate(settings.cert_dir, settings.extra_sans)
        ssl_args = {"ssl_certfile": str(cert), "ssl_keyfile": str(key)}

    print()
    print("=" * 64)
    print(" HighLo camera server")
    print("=" * 64)
    print(f" 1. On your phone, scan this code (or open the link):\n")
    print_qr(phone_url)
    print(f"\n    {phone_url}\n")
    if settings.tls:
        print("    Your phone will warn that the certificate is not trusted - that is")
        print("    expected (it is your own). Choose 'Advanced' > 'Proceed'.\n")
    print(" 2. In HighLo, open the Camera settings and enter:")
    print(f"      Server address : {base}")
    print(f"      Access token   : Check .env")
    if settings.viewer_token_is_new:
        print("      (new token, saved to .env)")
    if settings.tls:
        print(f"    Also open {base} once in the browser you use for HighLo and accept")
        print("    the same certificate warning, or the browser will block the connection.")
    print("=" * 64)
    print()

    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_level="warning",
        ws_max_size=settings.max_frame_bytes + 1024,
        **ssl_args,
    )


if __name__ == "__main__":
    main()
