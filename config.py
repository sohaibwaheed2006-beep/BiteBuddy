"""BiteBuddy configuration."""

import os
import socket

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


def _is_mysql_local_available():
    """Return True when a MySQL server is listening on localhost:3306."""
    try:
        with socket.create_connection(('localhost', 3306), timeout=0.5):
            return True
    except OSError:
        return False


def _database_url():
    """Pick the database: DATABASE_URL (cloud) > local MySQL > local SQLite."""
    db_url = os.environ.get('DATABASE_URL')
    if db_url:
        # Strip ssl-mode parameters that crash PyMySQL
        for param in ('?ssl-mode=', '?ssl_mode=', '?sslmode=', '&ssl-mode=', '&ssl_mode=', '&sslmode='):
            if param in db_url:
                db_url = db_url.split(param)[0]
        if db_url.startswith('mysql://'):
            db_url = db_url.replace('mysql://', 'mysql+pymysql://', 1)
        return db_url

    if _is_mysql_local_available():
        user = os.environ.get('MYSQL_USER', 'root')
        password = os.environ.get('MYSQL_PASSWORD', 'sohaib2006')
        database = os.environ.get('MYSQL_DATABASE', 'bitebuddy')
        return f'mysql+pymysql://{user}:{password}@localhost/{database}'

    return 'sqlite:///' + os.path.join(BASE_DIR, 'bitebuddy.db')


_DB_URI = _database_url()
# Use SSL for cloud databases (e.g. Aiven), not for local development
_USE_DB_SSL = bool(os.environ.get('DATABASE_URL')) and not any(
    host in _DB_URI for host in ('localhost', '127.0.0.1', 'sqlite'))


class Config:
    """Base configuration."""
    APP_NAME = 'BiteBuddy'
    SECRET_KEY = os.environ.get('SECRET_KEY', 'bitebuddy-dev-secret-change-in-production')

    SQLALCHEMY_DATABASE_URI = _DB_URI
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    if _USE_DB_SSL:
        SQLALCHEMY_ENGINE_OPTIONS = {'connect_args': {'ssl': {}}}

    # CSRF protection for every POST form (tokens live as long as the session)
    WTF_CSRF_ENABLED = True
    WTF_CSRF_TIME_LIMIT = None

    # Static assets are cache-busted with ?v=<mtime>, so they can be cached for a week
    SEND_FILE_MAX_AGE_DEFAULT = 60 * 60 * 24 * 7

    # Flat delivery charge added to every order (Rs.)
    DELIVERY_FEE = 100


class DevelopmentConfig(Config):
    """Development configuration."""
    DEBUG = True


class ProductionConfig(Config):
    """Production configuration."""
    DEBUG = False


config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig,
}
