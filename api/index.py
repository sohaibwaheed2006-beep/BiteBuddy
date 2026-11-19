"""Vercel entry point for BiteBuddy."""

from app import create_app

flask_app = create_app('production')

_ENTRY = '/api/index.py'


def app(environ, start_response):
    """WSGI wrapper: if Vercel hands us the function path instead of the visitor's URL, undo it."""
    path = environ.get('PATH_INFO', '') or '/'
    if path.startswith(_ENTRY):
        environ['PATH_INFO'] = path[len(_ENTRY):] or '/'
    return flask_app(environ, start_response)
