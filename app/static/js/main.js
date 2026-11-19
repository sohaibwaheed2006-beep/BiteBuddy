/* ==========================================================================
   BiteBuddy — site-wide interactions (no dependencies)
   ========================================================================== */
(() => {
    'use strict';

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    const BB = (window.BB = window.BB || {});

    /* ── Navbar: scrolled state ─────────────────────────────────────────── */
    const nav = $('#bb-nav');
    const onScroll = () => nav && nav.classList.toggle('is-scrolled', window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    /* ── User dropdown ──────────────────────────────────────────────────── */
    const userBtn = $('#bb-user-btn');
    const userMenu = $('#bb-user-menu');
    if (userBtn && userMenu) {
        const setOpen = (open) => {
            userMenu.classList.toggle('is-open', open);
            userBtn.setAttribute('aria-expanded', String(open));
        };
        userBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!userMenu.classList.contains('is-open')); });
        document.addEventListener('click', (e) => { if (!userMenu.contains(e.target)) setOpen(false); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    }

    /* ── Mobile drawer ──────────────────────────────────────────────────── */
    const drawerBtn = $('#bb-drawer-open');
    const setDrawer = (open) => {
        document.body.classList.toggle('drawer-open', open);
        if (drawerBtn) drawerBtn.setAttribute('aria-expanded', String(open));
    };
    if (drawerBtn) drawerBtn.addEventListener('click', () => setDrawer(true));
    $$('[data-drawer-close]').forEach((el) => el.addEventListener('click', () => setDrawer(false)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setDrawer(false); });

    /* ── Toasts ─────────────────────────────────────────────────────────── */
    const toastStack = $('#bb-toasts');
    const dismissToast = (toast) => {
        if (!toast || toast.classList.contains('is-leaving')) return;
        toast.classList.add('is-leaving');
        setTimeout(() => toast.remove(), 450);
    };
    const armToast = (toast, life = 6000) => {
        toast.style.setProperty('--life', `${life}ms`);
        const close = $('.bb-toast__close', toast);
        if (close) close.addEventListener('click', () => dismissToast(toast));
        let timer = setTimeout(() => dismissToast(toast), life);
        toast.addEventListener('mouseenter', () => { clearTimeout(timer); const bar = $('.bb-toast__bar', toast); if (bar) bar.style.animationPlayState = 'paused'; });
        toast.addEventListener('mouseleave', () => { timer = setTimeout(() => dismissToast(toast), 2000); });
    };
    $$('.bb-toast', toastStack || document).forEach((t) => armToast(t));

    /** Show a toast. `message` is plain text (never HTML). */
    BB.toast = (message, type = 'success', { image } = {}) => {
        if (!toastStack) return;
        const toast = document.createElement('div');
        toast.className = `bb-toast bb-toast--${type}`;
        toast.setAttribute('role', 'status');
        let lead;
        if (image) {
            lead = document.createElement('img');
            lead.className = 'bb-toast__thumb';
            lead.src = image;
            lead.alt = '';
        } else {
            lead = document.createElement('span');
            lead.className = 'bb-toast__icon';
            const icon = type === 'success' ? 'bi-check-circle-fill' : type === 'error' ? 'bi-exclamation-octagon-fill' : 'bi-info-circle-fill';
            lead.innerHTML = `<i class="bi ${icon}"></i>`;
        }
        const msg = document.createElement('div');
        msg.className = 'bb-toast__msg';
        msg.textContent = message;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'bb-toast__close';
        close.setAttribute('aria-label', 'Dismiss');
        close.innerHTML = '<i class="bi bi-x-lg text-xs"></i>';
        const bar = document.createElement('span');
        bar.className = 'bb-toast__bar';
        toast.append(lead, msg, close, bar);
        toastStack.appendChild(toast);
        armToast(toast, 4500);
    };

    /* ── Scroll reveal (IntersectionObserver + CSS transitions) ─────────── */
    const revealEls = $$('[data-reveal]');
    if (revealEls.length) {
        const settle = (el) => {
            el.classList.add('is-in');
            // once the entrance transition is over, let tilt/hover own `transform` again
            const delay = parseFloat(getComputedStyle(el).getPropertyValue('--reveal-delay')) || 0;
            setTimeout(() => el.classList.add('is-settled'), (delay + 1) * 1000);
        };
        if (!('IntersectionObserver' in window) || reducedMotion) {
            revealEls.forEach(settle);
        } else {
            const io = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) { settle(entry.target); io.unobserve(entry.target); }
                });
            }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
            revealEls.forEach((el) => io.observe(el));
        }
    }
    // hero headline entrance
    requestAnimationFrame(() => document.body.classList.add('is-loaded'));

    /* ── Images fade in once decoded (no pop-in) ────────────────────────── */
    $$('img.bb-fade').forEach((img) => {
        const done = () => img.classList.add('is-loaded');
        if (img.complete && img.naturalWidth) done();
        else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); }
    });

    /* ── Gentle scroll parallax: [data-parallax="-0.06"] ────────────────── */
    const parallaxEls = $$('[data-parallax]');
    if (parallaxEls.length && !reducedMotion) {
        let ticking = false;
        const update = () => {
            ticking = false;
            const vh = window.innerHeight;
            parallaxEls.forEach((el) => {
                const host = el.parentElement.getBoundingClientRect();
                if (host.bottom < -100 || host.top > vh + 100) return;
                // the image is taller than its frame; drift within that slack so no edge ever shows
                const slack = Math.max(0, el.offsetHeight - host.height) / 2;
                const raw = (host.top + host.height / 2 - vh / 2) * parseFloat(el.dataset.parallax);
                const offset = Math.max(-slack, Math.min(slack, raw));
                el.style.transform = `translate3d(0, ${(offset - slack).toFixed(1)}px, 0)`;
            });
        };
        const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
        window.addEventListener('scroll', request, { passive: true });
        window.addEventListener('resize', request);
        update();
    }

    /* ── Product photo zoom follows the pointer ─────────────────────────── */
    if (finePointer && !reducedMotion) {
        $$('[data-zoom]').forEach((box) => {
            box.addEventListener('pointerenter', () => box.classList.add('is-zooming'));
            box.addEventListener('pointerleave', () => box.classList.remove('is-zooming'));
            box.addEventListener('pointermove', (e) => {
                const r = box.getBoundingClientRect();
                box.style.setProperty('--zx', `${((e.clientX - r.left) / r.width) * 100}%`);
                box.style.setProperty('--zy', `${((e.clientY - r.top) / r.height) * 100}%`);
            });
        });
    }

    /* ── Animated counters ──────────────────────────────────────────────── */
    const counters = $$('[data-count]');
    if (counters.length) {
        const run = (el) => {
            const target = parseFloat(el.dataset.count);
            const decimals = parseInt(el.dataset.decimals || '0', 10);
            const suffix = el.dataset.suffix || '';
            if (reducedMotion) { el.textContent = target.toFixed(decimals) + suffix; return; }
            const start = performance.now();
            const dur = 1600;
            const tick = (now) => {
                const p = Math.min(1, (now - start) / dur);
                const eased = 1 - Math.pow(1 - p, 4);
                el.textContent = (target * eased).toFixed(decimals) + suffix;
                if (p < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        };
        if ('IntersectionObserver' in window) {
            const cio = new IntersectionObserver((entries) => entries.forEach((en) => {
                if (en.isIntersecting) { run(en.target); cio.unobserve(en.target); }
            }), { threshold: 0.5 });
            counters.forEach((c) => cio.observe(c));
        } else counters.forEach(run);
    }

    /* ── Cart badge helpers ─────────────────────────────────────────────── */
    BB.setCartCount = (count) => {
        $$('.js-cart-count').forEach((badge) => {
            badge.textContent = count;
            badge.classList.remove('is-bump');
            void badge.offsetWidth; // restart animation
            badge.classList.add('is-bump');
        });
    };

    /* fly a product image into the cart icon */
    const flyToCart = (img) => {
        const target = $('.js-cart-target');
        if (!img || !target || reducedMotion) return;
        const from = img.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        if (!from.width) return;
        const clone = img.cloneNode();
        clone.className = 'bb-fly';
        const size = Math.min(from.width, 120);
        Object.assign(clone.style, {
            width: `${size}px`, height: `${size}px`,
            left: `${from.left + from.width / 2 - size / 2}px`, top: `${from.top + from.height / 2 - size / 2}px`,
        });
        document.body.appendChild(clone);
        const dx = to.left + to.width / 2 - (from.left + from.width / 2);
        const dy = to.top + to.height / 2 - (from.top + from.height / 2);
        const anim = clone.animate([
            { transform: 'translate(0,0) scale(1)', opacity: 1, borderRadius: '16px' },
            { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(.55)`, opacity: 0.95, offset: 0.5 },
            { transform: `translate(${dx}px, ${dy}px) scale(.12)`, opacity: 0, borderRadius: '50%' },
        ], { duration: 750, easing: 'cubic-bezier(.45,0,.25,1)' });
        anim.onfinish = () => clone.remove();
    };

    /* ── AJAX add to cart ───────────────────────────────────────────────── */
    document.addEventListener('submit', async (e) => {
        const form = e.target.closest('.js-add-to-cart');
        if (!form) return;
        e.preventDefault();
        const btn = form.querySelector('[type="submit"]');
        if (btn && btn.classList.contains('is-loading')) return;
        if (btn) btn.classList.add('is-loading');

        try {
            const res = await fetch(form.action, {
                method: 'POST',
                body: new FormData(form),
                headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
                credentials: 'same-origin',
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.message || 'Could not add to cart');

            BB.setCartCount(data.cart_count);
            const card = form.closest('.bb-food-card, [data-product]');
            const img = card
                ? ($$('[data-fly-source]', card).find((el) => el.getBoundingClientRect().width > 0) || card.querySelector('img'))
                : null;
            flyToCart(img);
            BB.toast(data.message || 'Added to cart', 'success', { image: data.item_image });
            if (btn) {
                btn.classList.remove('is-loading');
                btn.classList.add('is-success');
                const icon = btn.querySelector('i');
                const prev = icon ? icon.className : '';
                if (icon) icon.className = 'bi bi-check-lg';
                setTimeout(() => { btn.classList.remove('is-success'); if (icon) icon.className = prev; }, 1400);
            }
        } catch (err) {
            if (btn) btn.classList.remove('is-loading');
            BB.toast(err.message || 'Something went wrong — please try again.', 'error');
        }
    });

    /* ── Quantity steppers ──────────────────────────────────────────────── */
    document.addEventListener('click', (e) => {
        const step = e.target.closest('[data-qty-step]');
        if (!step) return;
        const wrap = step.closest('.bb-qty');
        const input = wrap && wrap.querySelector('input');
        if (!input) return;
        const min = parseInt(input.min || '1', 10);
        const max = parseInt(input.max || '50', 10);
        const next = Math.max(min, Math.min(max, (parseInt(input.value, 10) || min) + parseInt(step.dataset.qtyStep, 10)));
        if (String(next) === input.value) return;
        input.value = next;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    /* ── Password visibility + strength ─────────────────────────────────── */
    $$('[data-toggle-password]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.togglePassword);
            if (!input) return;
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.innerHTML = `<i class="bi ${show ? 'bi-eye-slash' : 'bi-eye'}"></i>`;
            btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        });
    });
    $$('[data-strength-for]').forEach((meter) => {
        const input = document.getElementById(meter.dataset.strengthFor);
        const label = document.getElementById(meter.dataset.strengthLabel);
        if (!input) return;
        const words = ['', 'Too weak', 'Okay', 'Good', 'Strong'];
        input.addEventListener('input', () => {
            const v = input.value;
            let level = 0;
            if (v.length) {
                level = 1;
                if (v.length >= 6) {
                    level += (v.length >= 10 ? 1 : 0)
                        + (/[A-Z]/.test(v) && /[a-z]/.test(v) ? 1 : 0)
                        + (/\d/.test(v) || /[^A-Za-z0-9]/.test(v) ? 1 : 0);
                    level = Math.max(2, Math.min(4, level));
                }
            }
            meter.dataset.level = level;
            if (label) label.textContent = words[level];
        });
    });
    $$('[data-match-for]').forEach((input) => {
        const other = document.getElementById(input.dataset.matchFor);
        const hint = document.getElementById(input.dataset.matchHint);
        if (!other) return;
        const check = () => {
            const ok = !input.value || input.value === other.value;
            input.setCustomValidity(ok ? '' : 'Passwords do not match');
            if (hint) {
                hint.textContent = input.value ? (ok ? 'Passwords match' : 'Passwords do not match') : '';
                hint.style.color = ok ? '#15803d' : '#dc2626';
            }
        };
        input.addEventListener('input', check);
        other.addEventListener('input', check);
    });

    /* ── Forms: loading state + no double submit ────────────────────────── */
    document.addEventListener('submit', (e) => {
        const form = e.target;
        if (!form.matches('[data-loading]') || e.defaultPrevented) return;
        const btn = form.querySelector('[type="submit"]');
        if (btn) {
            if (btn.classList.contains('is-loading')) { e.preventDefault(); return; }
            btn.classList.add('is-loading');
        }
    });

    /* ── Confirm dialogs for destructive forms ──────────────────────────── */
    document.addEventListener('submit', (e) => {
        const msg = e.target.dataset && e.target.dataset.confirm;
        if (msg && !window.confirm(msg)) e.preventDefault();
    }, true);

    /* ── Live menu filter ───────────────────────────────────────────────── */
    const filter = $('[data-menu-filter]');
    if (filter) {
        const cards = $$('.js-menu-card');
        const empty = $('#bb-filter-empty');
        const count = $('#bb-filter-count');
        filter.addEventListener('input', () => {
            const q = filter.value.trim().toLowerCase();
            let shown = 0;
            cards.forEach((card) => {
                const hit = !q || (card.dataset.name || '').includes(q);
                card.style.display = hit ? '' : 'none';
                if (hit) shown++;
            });
            if (empty) empty.classList.toggle('hidden', shown > 0);
            if (count) count.textContent = shown;
        });
    }

    /* ── Segmented control pill ─────────────────────────────────────────── */
    BB.syncSegment = (seg) => {
        const active = seg.querySelector('button.is-active');
        const pill = seg.querySelector('.bb-segment__pill');
        if (!active || !pill) return;
        pill.style.width = `${active.offsetWidth}px`;
        pill.style.transform = `translateX(${active.offsetLeft - 4.8}px)`;
    };
    $$('.bb-segment').forEach((seg) => {
        BB.syncSegment(seg);
        window.addEventListener('resize', () => BB.syncSegment(seg));
        document.fonts && document.fonts.ready.then(() => BB.syncSegment(seg));
    });

    /* ── Credit card preview (payment page) ──────────────────────────── */
    const ccard = $('.bb-ccard');
    if (ccard) {
        const bind = (inputId, outId, fallback, fmt = (v) => v) => {
            const input = document.getElementById(inputId);
            const out = document.getElementById(outId);
            if (!input || !out) return;
            const upd = () => { out.textContent = input.value ? fmt(input.value) : fallback; };
            input.addEventListener('input', upd);
            upd();
        };
        const num = $('#card_number');
        if (num) num.addEventListener('input', () => {
            num.value = num.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
        });
        const exp = $('#expiry');
        if (exp) exp.addEventListener('input', () => {
            const d = exp.value.replace(/\D/g, '').slice(0, 4);
            exp.value = d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d;
        });
        const cvc = $('#cvc');
        if (cvc) cvc.addEventListener('input', () => { cvc.value = cvc.value.replace(/\D/g, '').slice(0, 4); });
        bind('card_number', 'cc-number', '•••• •••• •••• ••••', (v) => (v + ' •••• •••• •••• ••••').slice(0, 19));
        bind('card_name', 'cc-name', 'YOUR NAME');
        bind('expiry', 'cc-expiry', 'MM / YY');
        bind('cvc', 'cc-cvc', '•••', (v) => v.replace(/./g, '•'));
        if (cvc) {
            cvc.addEventListener('focus', () => ccard.classList.add('is-flipped'));
            cvc.addEventListener('blur', () => ccard.classList.remove('is-flipped'));
        }
        if (finePointer && !reducedMotion) {
            const inner = $('.bb-ccard__inner', ccard);
            ccard.addEventListener('pointermove', (e) => {
                if (ccard.classList.contains('is-flipped')) return;
                const r = ccard.getBoundingClientRect();
                const x = (e.clientX - r.left) / r.width - 0.5;
                const y = (e.clientY - r.top) / r.height - 0.5;
                inner.style.transform = `rotateY(${x * 18}deg) rotateX(${-y * 14}deg)`;
            });
            ccard.addEventListener('pointerleave', () => { inner.style.transform = ''; });
            cvc && cvc.addEventListener('focus', () => { inner.style.transform = ''; });
        }
    }

    /* ── Order tracking: animate progress on load ───────────────────────── */
    const track = $('.bb-track');
    if (track) {
        const pct = parseFloat(track.dataset.progress || '0');
        const fill = $('.bb-track__fill', track);
        const rider = $('.bb-track__rider', track);
        requestAnimationFrame(() => setTimeout(() => {
            if (fill) fill.style.width = `${pct}%`;
            if (rider) rider.style.left = `${pct}%`;
        }, 250));
    }
})();
