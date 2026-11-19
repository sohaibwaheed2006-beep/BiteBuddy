"""BiteBuddy application factory."""

import os
from datetime import datetime, timezone

from flask import Flask, flash, jsonify, redirect, render_template, request, url_for
from flask_login import LoginManager
from flask_sqlalchemy import SQLAlchemy
from flask_wtf.csrf import CSRFError, CSRFProtect

from config import config

db = SQLAlchemy()
csrf = CSRFProtect()
login_manager = LoginManager()
login_manager.login_view = 'auth.login'
login_manager.login_message = 'Please sign in to continue.'
login_manager.login_message_category = 'info'


def create_app(config_name='default'):
    """Create and configure the Flask application."""
    app = Flask(__name__)
    app.config.from_object(config[config_name])

    db.init_app(app)
    csrf.init_app(app)
    login_manager.init_app(app)

    from app.admin.routes import admin_bp
    from app.auth.routes import auth_bp
    from app.cart.routes import cart_bp
    from app.main.routes import main_bp
    from app.menu.routes import menu_bp
    from app.orders.routes import orders_bp
    from app.payment.routes import payment_bp

    for blueprint in (auth_bp, main_bp, menu_bp, cart_bp, orders_bp, payment_bp, admin_bp):
        app.register_blueprint(blueprint)

    _register_template_helpers(app)
    _register_error_handlers(app)

    with app.app_context():
        from app import models  # noqa: F401
        db.create_all()
        _seed_database()

    return app


def _register_template_helpers(app):
    """Values and helpers available in every template."""
    static_dir = os.path.join(app.root_path, 'static')

    def asset(filename):
        """Static URL with a ?v=<mtime> cache-buster so browsers pick up new deploys."""
        try:
            version = int(os.path.getmtime(os.path.join(static_dir, filename)))
        except OSError:
            version = 0
        return url_for('static', filename=filename, v=version)

    @app.context_processor
    def inject_globals():
        return {
            'app_name': app.config['APP_NAME'],
            'delivery_fee': app.config['DELIVERY_FEE'],
            'current_year': datetime.now(timezone.utc).year,
            'asset': asset,
        }


def _register_error_handlers(app):
    from app.utils import safe_redirect_target

    @app.errorhandler(CSRFError)
    def handle_csrf_error(error):
        message = 'Your session expired. Please try that again.'
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify(success=False, message=message), 400
        flash(message, 'error')
        return redirect(safe_redirect_target(request.referrer, fallback=url_for('main.home')))

    @app.errorhandler(404)
    def not_found(error):
        return render_template('errors/404.html'), 404

    @app.errorhandler(500)
    def server_error(error):
        db.session.rollback()
        return render_template('errors/500.html'), 500


def _seed_database():
    """Create the default admin, categories and menu on an empty database."""
    from werkzeug.security import check_password_hash, generate_password_hash

    from app.models import Category, MenuItem, User

    admin = User.query.filter_by(role='admin').first()
    if not admin:
        db.session.add(User(
            username='admin',
            email='admin@bitebuddy.com',
            password_hash=generate_password_hash(os.environ.get('ADMIN_PASSWORD', 'sohaibAdmin2026!')),
            phone='03001234567',
            role='admin',
        ))
        db.session.commit()
    elif check_password_hash(admin.password_hash, 'admin123'):
        # Upgrade the old weak default password if it is still in use
        admin.password_hash = generate_password_hash(os.environ.get('ADMIN_PASSWORD', 'sohaibAdmin2026!'))
        db.session.commit()

    if Category.query.count() == 0:
        db.session.add_all([
            Category(name='Burgers', image_url='/static/images/cat_burgers.jpg',
                     description='Juicy flame-grilled burgers loaded with flavor'),
            Category(name='Fried Chicken', image_url='/static/images/cat_chicken.jpg',
                     description='Crispy golden fried chicken, our signature'),
            Category(name='Pizza', image_url='/static/images/cat_pizza.jpg',
                     description='Hand-tossed pizzas with premium toppings'),
            Category(name='Wraps & Rolls', image_url='/static/images/cat_wraps.jpg',
                     description='Wrapped perfection with sauces and fillings'),
            Category(name='Sides', image_url='/static/images/cat_sides.jpg',
                     description='Fries, coleslaw, and more to complete your meal'),
            Category(name='Beverages', image_url='/static/images/cat_beverages.jpg',
                     description='Ice-cold drinks and refreshing shakes'),
            Category(name='Desserts', image_url='/static/images/cat_desserts.jpg',
                     description='Sweet treats to finish your feast'),
        ])
        db.session.commit()

    if MenuItem.query.count() == 0:
        items = [
            # Burgers (category 1)
            ('Classic Smash Burger', 'Double beef patty, cheddar, lettuce, tomato, special sauce', 850, 'item_smash.jpg', 1),
            ('Zinger Burger', 'Crispy chicken fillet, spicy mayo, fresh lettuce', 750, 'item_zinger.jpg', 1),
            ('BBQ Tower Burger', 'Grilled chicken, crispy onion rings, smoky BBQ sauce', 950, 'item_bbq.jpg', 1),
            ('Cheese Lover Burger', 'Triple cheese melt with beef patty and jalapeños', 900, 'item_cheese.jpg', 1),
            # Fried Chicken (category 2)
            ('2-Piece Chicken', '2 pieces of our signature crispy fried chicken', 550, 'item_2pc.jpg', 2),
            ('5-Piece Bucket', '5 pieces of crispy fried chicken, feeds 2', 1200, 'item_5pc.jpg', 2),
            ('10-Piece Family Bucket', '10 pieces of crispy chicken for the whole family', 2200, 'item_10pc.jpg', 2),
            ('Spicy Wings (6 pcs)', 'Hot and spicy chicken wings with dipping sauce', 650, 'item_wings.jpg', 2),
            # Pizza (category 3)
            ('Pepperoni Feast Pizza', 'Loaded with double pepperoni and mozzarella', 1200, 'item_pepperoni.jpg', 3),
            ('Chicken Supreme Pizza', 'Grilled chicken, peppers, onions, olives, mushrooms', 1400, 'item_supreme.jpg', 3),
            ('Margherita Pizza', 'Classic tomato, fresh mozzarella, basil', 900, 'item_margherita.jpg', 3),
            # Wraps & Rolls (category 4)
            ('Chicken Shawarma', 'Marinated chicken, garlic sauce, pickles in pita', 550, 'item_shawarma.jpg', 4),
            ('Zinger Wrap', 'Crispy chicken strip, coleslaw, chili sauce in tortilla', 600, 'item_wrap.jpg', 4),
            ('Beef Seekh Roll', 'Spiced beef seekh kebab rolled in paratha', 500, 'item_seekh.jpg', 4),
            # Sides (category 5)
            ('French Fries (Large)', 'Crispy golden french fries with ketchup', 350, 'item_fries.jpg', 5),
            ('Coleslaw', 'Creamy fresh coleslaw', 200, 'item_coleslaw.jpg', 5),
            ('Onion Rings', 'Crispy battered onion rings', 300, 'item_onion.jpg', 5),
            ('Corn on the Cob', 'Buttered sweet corn on the cob', 250, 'item_corn.jpg', 5),
            # Beverages (category 6)
            ('Coca-Cola (500ml)', 'Ice-cold classic Coca-Cola', 180, 'item_cola.jpg', 6),
            ('Mango Shake', 'Thick creamy mango milkshake', 400, 'item_mango.jpg', 6),
            ('Chocolate Shake', 'Rich chocolate milkshake with whipped cream', 450, 'item_choco.jpg', 6),
            ('Mint Lemonade', 'Fresh mint and lemon cooler', 250, 'item_lemon.jpg', 6),
            # Desserts (category 7)
            ('Chocolate Lava Cake', 'Warm chocolate cake with molten center', 500, 'item_lava.jpg', 7),
            ('Vanilla Sundae', 'Vanilla ice cream with chocolate drizzle', 350, 'item_sundae.jpg', 7),
            ('Brownie with Ice Cream', 'Fudge brownie topped with vanilla scoop', 450, 'item_brownie.jpg', 7),
        ]
        db.session.add_all([
            MenuItem(name=name, description=desc, price=price, image_url=f'/static/images/{img}',
                     category_id=cat_id, is_available=True)
            for name, desc, price, img, cat_id in items
        ])
        db.session.commit()
