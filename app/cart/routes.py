"""Cart routes: View, Add, Update, Remove, Clear."""

from flask import Blueprint, render_template, redirect, url_for, flash, request, jsonify
from flask_login import login_required, current_user
from markupsafe import escape
from app import db
from app.models import CartItem, MenuItem
from app.utils import safe_redirect_target


def _is_ajax():
    return request.headers.get('X-Requested-With') == 'XMLHttpRequest'


def _cart_count():
    return sum(c.quantity for c in CartItem.query.filter_by(user_id=current_user.id).all())


# Server-side option prices — the form only says *which* option was picked, never what it costs.
SIZE_PRICES = {'Small': 0.0, 'Medium': 200.0, 'Large': 400.0}
ADDON_PRICES = {'Extra Cheese': 100.0, 'Extra Patty': 300.0}


def _parse_option(raw, price_table):
    """Map an 'Name|price' form value to (name, server_price), or None if unknown."""
    if not raw:
        return None
    name = raw.split('|', 1)[0].strip()
    if name not in price_table:
        return None
    return name, price_table[name]

cart_bp = Blueprint('cart', __name__, url_prefix='/cart')


@cart_bp.route('/')
@login_required
def view_cart():
    """View shopping cart."""
    cart_items = CartItem.query.filter_by(user_id=current_user.id).all()
    total = sum((item.menu_item.price + (item.options_total or 0)) * item.quantity for item in cart_items)
    return render_template('cart/view.html', cart_items=cart_items, total=total)


@cart_bp.route('/add/<int:item_id>', methods=['POST'])
@login_required
def add_to_cart(item_id):
    """Add item to cart."""
    menu_item = MenuItem.query.get_or_404(item_id)
    if not menu_item.is_available:
        if _is_ajax():
            return jsonify({'success': False, 'message': 'This item is currently unavailable.'}), 400
        flash('This item is currently unavailable.', 'error')
        return redirect(url_for('menu.browse'))

    quantity = max(1, min(50, request.form.get('quantity', 1, type=int) or 1))

    options_list = []
    options_total = 0.0

    size = _parse_option(request.form.get('size'), SIZE_PRICES)
    if size:
        name, price = size
        options_list.append(f"{name} (+Rs. {price:.0f})" if price > 0 else name)
        options_total += price

    for raw in dict.fromkeys(request.form.getlist('addon')):  # de-duplicate
        addon = _parse_option(raw, ADDON_PRICES)
        if addon:
            name, price = addon
            options_list.append(f"{name} (+Rs. {price:.0f})")
            options_total += price

    options_str = ", ".join(options_list) if options_list else None

    # Check if already in cart
    cart_item = CartItem.query.filter_by(user_id=current_user.id, item_id=item_id, options=options_str).first()
    if cart_item:
        cart_item.quantity += quantity
    else:
        cart_item = CartItem(user_id=current_user.id, item_id=item_id, quantity=quantity, options=options_str, options_total=options_total)
        db.session.add(cart_item)

    db.session.commit()

    # AJAX requests get JSON only — flashing here too would re-show the toast on the next page load
    if _is_ajax():
        return jsonify({
            'success': True,
            'cart_count': _cart_count(),
            'item_name': menu_item.name,
            'item_image': menu_item.image_url,
            'message': f'{menu_item.name} added to your cart',
        })

    flash(f'<strong>{escape(menu_item.name)}</strong> added to your cart!', 'success')
    return redirect(safe_redirect_target(request.referrer, fallback=url_for('menu.browse')))


@cart_bp.route('/update/<int:cart_item_id>', methods=['POST'])
@login_required
def update_cart(cart_item_id):
    """Update cart item quantity."""
    cart_item = CartItem.query.get_or_404(cart_item_id)
    if cart_item.user_id != current_user.id:
        flash('Unauthorized action.', 'error')
        return redirect(url_for('cart.view_cart'))

    quantity = request.form.get('quantity', 1, type=int)
    if quantity is None or quantity < 1:
        db.session.delete(cart_item)
    else:
        cart_item.quantity = min(quantity, 50)
    db.session.commit()
    flash('Cart updated!', 'success')
    return redirect(url_for('cart.view_cart'))


@cart_bp.route('/remove/<int:cart_item_id>', methods=['POST'])
@login_required
def remove_from_cart(cart_item_id):
    """Remove item from cart."""
    cart_item = CartItem.query.get_or_404(cart_item_id)
    if cart_item.user_id != current_user.id:
        flash('Unauthorized action.', 'error')
        return redirect(url_for('cart.view_cart'))

    db.session.delete(cart_item)
    db.session.commit()

    if _is_ajax():
        return jsonify({'success': True, 'cart_count': _cart_count()})

    flash('Item removed from cart.', 'info')
    return redirect(url_for('cart.view_cart'))


@cart_bp.route('/clear', methods=['POST'])
@login_required
def clear_cart():
    """Clear entire cart."""
    CartItem.query.filter_by(user_id=current_user.id).delete()
    db.session.commit()
    flash('Cart cleared.', 'info')
    return redirect(url_for('cart.view_cart'))


@cart_bp.route('/count')
@login_required
def cart_count():
    """Get cart count (AJAX endpoint)."""
    return jsonify({'count': _cart_count()})
