# BiteBuddy 🍔

A full-stack food ordering web app built with **Flask**, with a dark, animated 3D front end: interactive three.js burgers and pizzas, tilt-reactive cards and live order tracking.

## Features

- **Interactive 3D food.** Procedurally modelled burger and pizza in three.js. Drag to spin, scroll or tap to explode them into labelled layers. On item pages the 3D build updates live as you pick add-ons and sizes.
- **Accounts.** Register, sign in and edit your profile, with password strength and match checks.
- **Menu.** Browse by category, search, live-filter, and see every dish with its own photo.
- **Cart.** Add to cart instantly (AJAX, with a fly-to-cart animation), change quantities, clear the cart.
- **Checkout and payment.** Cash on delivery, or a simulated card gateway with a 3D card preview.
- **Order tracking.** Animated progress from *Received* to *Delivered*, with auto-refresh.
- **Admin dashboard.** Revenue and order stats, and full management of menu items, categories and order status.
- **Security.** CSRF protection on every form, server-side option pricing, safe redirects.

## Tech stack

- **Backend:** Flask, Flask-SQLAlchemy, Flask-Login, Flask-WTF (CSRF), PyMySQL
- **Frontend:** Jinja templates, Tailwind CSS (CDN), custom CSS design system, three.js (ES modules), vanilla JS
- **Database:** MySQL (`DATABASE_URL` or local server), with automatic SQLite fallback for local development
- **Hosting:** Vercel (`vercel.json` routes every request to `api/index.py`)

## Getting started

1. **Install dependencies** (Python 3.9+):
   ```bash
   python -m venv venv
   venv\Scripts\activate        # Windows  (source venv/bin/activate on macOS/Linux)
   pip install -r requirements.txt
   ```

2. **Pick a database.** The app chooses one automatically:
   - **`DATABASE_URL`** is used when set (e.g. a cloud MySQL such as Aiven).
   - Otherwise a **local MySQL** on `localhost:3306` is used, with the database `bitebuddy` (override with `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`).
   - Otherwise a **SQLite** file, `bitebuddy.db`, is created in the project folder.

   Tables, categories, menu items and an admin account are created automatically on first run.

3. **Run it:**
   ```bash
   python run.py
   ```
   Then open http://localhost:5000.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `SECRET_KEY` | Session and CSRF signing key. **Set this in production.** |
| `DATABASE_URL` | MySQL connection string for production. |
| `ADMIN_PASSWORD` | Password for the auto-created admin account (`admin@bitebuddy.com`). |
| `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` | Local MySQL overrides. |

## Project structure

```
app/
  __init__.py         app factory, CSRF, error pages, seeding
  models.py           User, Category, MenuItem, CartItem, Order, OrderItem, Payment
  auth/ main/ menu/ cart/ orders/ payment/ admin/   blueprints
  templates/          Jinja pages (+ _macros.html for shared UI)
  static/
    css/style.css     BiteBuddy design system
    js/main.js        site interactions (tilt, reveals, toasts, cart…)
    js/food3d.js      three.js stage: lighting, controls, explode, labels
    js/food-models.js procedural burger & pizza models
    images/           menu photography (see download_images.py for sources)
api/index.py          Vercel entry point
```

Menu photos are from [Unsplash](https://unsplash.com) under the Unsplash License.
