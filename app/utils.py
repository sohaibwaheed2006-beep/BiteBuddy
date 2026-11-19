"""Shared helpers for BiteBuddy."""

from urllib.parse import urljoin, urlparse

from flask import request


def is_safe_redirect(target):
    """True if `target` points back to this site (prevents open redirects)."""
    if not target:
        return False
    host_url = urlparse(request.host_url)
    redirect_url = urlparse(urljoin(request.host_url, target))
    return redirect_url.scheme in ('http', 'https') and redirect_url.netloc == host_url.netloc


def safe_redirect_target(*candidates, fallback):
    """Return the first candidate URL that stays on this site, else `fallback`."""
    for target in candidates:
        if is_safe_redirect(target):
            return target
    return fallback
