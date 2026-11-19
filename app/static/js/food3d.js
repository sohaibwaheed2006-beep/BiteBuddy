/* ==========================================================================
   BiteBuddy — interactive 3D food stage
   Mounts on any element with [data-food3d]:
     data-food3d-mode   = "hero" | "float" | "showcase"
     data-food3d-model  = "burger" | "pizza"
     data-food3d-form   = CSS selector of a form whose size/add-on inputs drive the model (showcase)
   Controls anywhere on the page:
     [data-food3d-switch="burger|pizza"][data-target="#stage-id"]
     [data-food3d-explode][data-target="#stage-id"]
   If WebGL is unavailable the element keeps its fallback <img>.
   ========================================================================== */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildBurger, buildPizza, buildBit, rng } from 'bb-models';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
const lowPower = coarsePointer || (navigator.hardwareConcurrency || 8) <= 4;
const { clamp, lerp, smoothstep, damp } = THREE.MathUtils;
const X_AXIS = new THREE.Vector3(1, 0, 0);

/* ── Tiny tween engine (keeps the module dependency-free) ───────────────── */
const ease = {
    outCubic: (t) => 1 - (1 - t) ** 3,
    inCubic: (t) => t * t * t,
    outBack: (t) => { const c1 = 1.4; const c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
};

class Tweens {
    constructor() { this.items = []; }
    to(target, props, { duration = 0.6, delay = 0, easing = ease.outCubic, onComplete } = {}) {
        const item = { target, props, duration, delay, easing, onComplete, t: 0, from: null };
        this.items.push(item);
        return item;
    }
    killOf(target) { this.items = this.items.filter((i) => i.target !== target); }
    update(dt) {
        if (!this.items.length) return;
        // onComplete callbacks may queue new tweens (e.g. a model switch builds the next model);
        // collect those separately so they aren't dropped by the filter below.
        const current = this.items;
        this.items = [];
        const alive = current.filter((it) => {
            if (it.delay > 0) { it.delay -= dt; return true; }
            if (!it.from) it.from = Object.fromEntries(Object.keys(it.props).map((k) => [k, it.target[k]]));
            it.t = Math.min(1, it.t + dt / it.duration);
            const e = it.easing(it.t);
            for (const k in it.props) it.target[k] = lerp(it.from[k], it.props[k], e);
            if (it.t >= 1) { if (it.onComplete) it.onComplete(); return false; }
            return true;
        });
        this.items = alive.concat(this.items);
    }
}

/* ── Shared sprite for embers / blob shadow ─────────────────────────────── */
function radialTexture(inner, outer, size = 128) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function disposeTree(obj) {
    obj.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
}

// lookY < 0 aims the camera below the model so it sits higher in the frame
const MODES = {
    hero: { margin: 1.12, autoSpin: 0.32, labels: true, bits: 14, embers: 130, bob: 0.06, lookY: 0 },
    float: { margin: 1.6, autoSpin: 0.26, labels: false, bits: 18, embers: 90, bob: 0.1, lookY: 0.15 },
    showcase: { margin: 1.18, autoSpin: 0.22, labels: true, bits: 0, embers: 40, bob: 0.03, lookY: 0 },
};

class FoodStage {
    constructor(el) {
        this.el = el;
        this.modeName = MODES[el.dataset.food3dMode] ? el.dataset.food3dMode : 'showcase';
        this.mode = MODES[this.modeName];
        this.quality = lowPower ? 'low' : 'high';
        this.tweens = new Tweens();
        this.labelsEl = el.querySelector('.bb3d__labels');
        this.labelEls = [];
        this.model = null;
        this.options = {};
        this.running = false;
        this.visible = true;
        this.state = {
            rotY: this.modeName === 'float' ? 0.6 : -0.55,
            rotX: 0.12,
            velY: 0,
            dragging: false,
            lastInteract: -Infinity,
            explode: 0,
            explodeToggle: 0,
            scrollExplode: 0,
            hoverX: 0,
            hoverY: 0,
            camX: 0,
            camY: 0,
        };
        this.clock = new THREE.Clock();

        this._initRenderer();
        this._initScene();
        this._bindPointer();
        this._observe();

        const form = el.dataset.food3dForm ? document.querySelector(el.dataset.food3dForm) : null;
        if (form) this._bindForm(form);

        this.setModel(el.dataset.food3dModel || 'burger', this._readForm(form), { instant: false });
        this._resize();
        this.el.classList.add('is-ready');
        this._start();
    }

    /* ── setup ─────────────────────────────────────────────────────────── */
    _initRenderer() {
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.12;
        renderer.shadowMap.enabled = !lowPower;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.setClearColor(0x000000, 0);
        const canvas = renderer.domElement;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('tabindex', '0');
        canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.el.classList.remove('is-ready'); this._stop(); });
        this.el.appendChild(canvas);
        this.renderer = renderer;
    }

    _initScene() {
        const scene = new THREE.Scene();
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();

        const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

        const key = new THREE.DirectionalLight('#ffe2c4', 2.6);
        key.position.set(3.5, 6.5, 4.5);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        Object.assign(key.shadow.camera, { near: 1, far: 22, left: -4.5, right: 4.5, top: 4.5, bottom: -4.5 });
        key.shadow.bias = -0.0004;
        key.shadow.normalBias = 0.03;
        key.shadow.radius = 5;
        const rim = new THREE.DirectionalLight('#ff5a1f', 3.2);
        rim.position.set(-4.5, 2.5, -4);
        const rim2 = new THREE.DirectionalLight('#ffb800', 1.3);
        rim2.position.set(4.5, 1.2, -3.5);
        const fill = new THREE.HemisphereLight('#fff1e0', '#3a1508', 0.55);
        scene.add(key, key.target, rim, rim2, fill);

        // hierarchy: root(bob) → tilt(model tilt + user pitch) → spin(turntable) → center(vertical centering) → model
        // tilt wraps spin so a tilted pizza turns around its own axis instead of wobbling.
        this.root = new THREE.Group();
        this.tilt = new THREE.Group();
        this.spin = new THREE.Group();
        this.center = new THREE.Group();
        this.root.add(this.tilt);
        this.tilt.add(this.spin);
        this.spin.add(this.center);
        scene.add(this.root);

        // soft contact shadow
        this.blob = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }),
        );
        this.blob.rotation.x = -Math.PI / 2;
        scene.add(this.blob);

        this._initEmbers(scene);
        this._initBits(scene);

        this.scene = scene;
        this.camera = camera;
    }

    _initEmbers(scene) {
        const count = lowPower ? Math.round(this.mode.embers * 0.5) : this.mode.embers;
        if (!count) return;
        const rand = rng(99);
        const pos = new Float32Array(count * 3);
        this.emberData = [];
        for (let i = 0; i < count; i++) {
            const a = rand() * Math.PI * 2;
            const r = 1.2 + rand() * 2.6;
            pos[i * 3] = Math.cos(a) * r;
            pos[i * 3 + 1] = -2.6 + rand() * 6;
            pos[i * 3 + 2] = Math.sin(a) * r - 0.5;
            this.emberData.push({ speed: 0.25 + rand() * 0.55, phase: rand() * 10, drift: 0.1 + rand() * 0.25 });
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const material = new THREE.PointsMaterial({
            size: 0.07, map: radialTexture('rgba(255,200,140,1)', 'rgba(255,90,31,0)', 64),
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9,
        });
        this.embers = new THREE.Points(geo, material);
        scene.add(this.embers);
    }

    _initBits(scene) {
        const count = this.mode.bits;
        this.bits = [];
        if (!count) return;
        const rand = rng(42);
        const kinds = ['tomato', 'lettuce', 'seed', 'cheese', 'pepperoni', 'basil', 'onion', 'olive', 'seed'];
        this.bitGroup = new THREE.Group();
        scene.add(this.bitGroup);
        for (let i = 0; i < count; i++) {
            const obj = buildBit(kinds[i % kinds.length], rand);
            const near = this.modeName === 'float' ? 2.1 : 2.3;
            this.bits.push({
                obj,
                radius: near + rand() * 1.3,
                speed: (0.12 + rand() * 0.22) * (rand() < 0.5 ? -1 : 1),
                phase: rand() * Math.PI * 2,
                incline: (rand() - 0.5) * 0.9,
                y: (rand() - 0.5) * 2.4,
                spin: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(2.2),
                scale: 0.8 + rand() * 0.5,
            });
            obj.scale.multiplyScalar(this.bits[i].scale);
            obj.traverse((o) => { if (o.isMesh) o.castShadow = false; });
            this.bitGroup.add(obj);
        }
    }

    _bindPointer() {
        const canvas = this.renderer.domElement;
        const s = this.state;
        let lastX = 0; let lastY = 0;
        const interact = () => {
            s.lastInteract = performance.now();
            this.el.classList.add('has-interacted');
        };
        canvas.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            s.dragging = true;
            lastX = e.clientX; lastY = e.clientY;
            canvas.setPointerCapture(e.pointerId);
            interact();
        });
        canvas.addEventListener('pointermove', (e) => {
            const r = this.el.getBoundingClientRect();
            s.hoverX = ((e.clientX - r.left) / r.width - 0.5) * 2;
            s.hoverY = ((e.clientY - r.top) / r.height - 0.5) * 2;
            if (!s.dragging) return;
            const dx = e.clientX - lastX; const dy = e.clientY - lastY;
            lastX = e.clientX; lastY = e.clientY;
            s.velY = dx * 0.0085;
            s.rotY += s.velY;
            s.rotX = clamp(s.rotX + dy * 0.005, -0.45, 0.8);
            interact();
        });
        const end = () => { s.dragging = false; };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('pointerleave', () => { s.hoverX = 0; s.hoverY = 0; });
        canvas.addEventListener('dblclick', () => { this.toggleExplode(); interact(); });
        canvas.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') { s.rotY -= 0.25; interact(); }
            else if (e.key === 'ArrowRight') { s.rotY += 0.25; interact(); }
            else if (e.key === 'ArrowUp') { s.rotX = clamp(s.rotX - 0.15, -0.45, 0.8); interact(); }
            else if (e.key === 'ArrowDown') { s.rotX = clamp(s.rotX + 0.15, -0.45, 0.8); interact(); }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggleExplode(); interact(); }
        });
        if (this.modeName === 'float') {
            window.addEventListener('pointermove', (e) => {
                s.hoverX = (e.clientX / window.innerWidth - 0.5) * 2;
                s.hoverY = (e.clientY / window.innerHeight - 0.5) * 2;
            }, { passive: true });
        }
    }

    _observe() {
        new ResizeObserver(() => this._resize()).observe(this.el);
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(([entry]) => {
                this.visible = entry.isIntersecting;
                if (this.visible) this._start(); else this._stop();
            }, { rootMargin: '120px' }).observe(this.el);
        }
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this._stop(); else if (this.visible) this._start();
        });
        if (this.modeName === 'hero') {
            const section = this.el.closest('[data-food3d-scroll]') || this.el.parentElement;
            const onScroll = () => {
                const r = section.getBoundingClientRect();
                const progress = clamp(-r.top / Math.max(1, r.height * 0.55), 0, 1);
                this.state.scrollExplode = reducedMotion ? 0 : smoothstep(progress, 0.04, 0.75);
            };
            window.addEventListener('scroll', onScroll, { passive: true });
            onScroll();
        }
    }

    /* ── showcase: keep the model in sync with the item's option form ──── */
    _readForm(form) {
        if (!form) return {};
        const addons = Array.from(form.querySelectorAll('input[name="addon"]:checked')).map((i) => i.value.split('|')[0]);
        const size = form.querySelector('input[name="size"]:checked');
        const sizeName = size ? size.value.split('|')[0] : 'Large';
        return {
            extraCheese: addons.includes('Extra Cheese'),
            extraPatty: addons.includes('Extra Patty'),
            size: { Small: 0.8, Medium: 0.9, Large: 1 }[sizeName] || 1,
        };
    }

    _bindForm(form) {
        form.addEventListener('change', () => {
            const next = this._readForm(form);
            const prev = this.options;
            if (this.model && this.model.kind === 'pizza' && next.size !== prev.size) {
                this.options = next;
                this.tweens.to(this.model.group.scale, { x: next.size, y: next.size, z: next.size }, { duration: 0.7, easing: ease.outBack });
                this.model.fit.w = 3.8 * next.size;
                return;
            }
            if (next.extraCheese !== prev.extraCheese || next.extraPatty !== prev.extraPatty) {
                this.setModel(this.model ? this.model.kind : 'burger', next, { quick: true });
                if (this.state.explodeToggle < 0.5) this.flashExplode();
            }
        });
    }

    /* ── public API ────────────────────────────────────────────────────── */
    setModel(kind, options = {}, { quick = false } = {}) {
        this.options = { ...this.options, ...options };
        const build = () => {
            const opts = { ...this.options, quality: this.quality };
            const model = kind === 'pizza' ? buildPizza(opts) : buildBurger(opts);
            this.center.add(model.group);
            this.model = model;
            this._buildLabels();
            this.renderer.domElement.setAttribute('aria-label',
                `Interactive 3D ${kind}. Drag to rotate, double-click or press Enter to see every layer.`);
            // layers drop into place one after another
            model.layers.forEach((layer, i) => {
                layer.drop = quick ? 0 : 2.6 + i * 0.35;
                layer.pop = quick && !layer.isExtra ? 1 : 0;
                if (reducedMotion) { layer.drop = 0; layer.pop = 1; return; }
                this.tweens.to(layer, { drop: 0 }, { duration: 0.9, delay: (quick ? 0 : 0.15) + i * 0.08, easing: ease.outBack });
                this.tweens.to(layer, { pop: 1 }, { duration: 0.6, delay: (quick ? 0 : 0.15) + i * 0.08, easing: ease.outBack });
            });
            this._resize();
        };

        const old = this.model;
        if (!old) { build(); return; }
        if (quick || reducedMotion) {
            this.center.remove(old.group);
            disposeTree(old.group);
            build();
            return;
        }
        const g = old.group;
        const anim = { s: g.scale.x, r: 0 };
        this.tweens.to(anim, { s: 0.001, r: 1.6 }, {
            duration: 0.38, easing: ease.inCubic,
            onComplete: () => { this.center.remove(g); disposeTree(g); build(); },
        });
        const tick = () => { g.scale.setScalar(Math.max(anim.s, 0.001)); g.rotation.y = anim.r; if (g.parent) requestAnimationFrame(tick); };
        tick();
        this.model = null;
        this._buildLabels();
    }

    toggleExplode(force) {
        const on = typeof force === 'boolean' ? force : this.state.explodeToggle < 0.5;
        this.state.explodeToggle = on ? 1 : 0;
        this.el.dispatchEvent(new CustomEvent('food3d:explode', { detail: { on } }));
        return on;
    }

    /** briefly open the stack so the user sees the layer they just added */
    flashExplode() {
        this.toggleExplode(true);
        clearTimeout(this._flashTimer);
        this._flashTimer = setTimeout(() => this.toggleExplode(false), 1600);
    }

    /* ── labels ────────────────────────────────────────────────────────── */
    _buildLabels() {
        if (!this.labelsEl) return;
        this.labelsEl.innerHTML = '';
        this.labelEls = [];
        if (!this.mode.labels || !this.model) return;
        this.model.layers.forEach((layer, i) => {
            const left = i % 2 === 1;
            const el = document.createElement('div');
            el.className = `bb3d__label${left ? ' is-left' : ''}`;
            el.style.setProperty('--dot', layer.color);
            const dot = document.createElement('span'); dot.className = 'bb3d__label-dot';
            const line = document.createElement('span'); line.className = 'bb3d__label-line';
            const text = document.createElement('span'); text.className = 'bb3d__label-text';
            const b = document.createElement('b'); b.textContent = layer.name;
            const small = document.createElement('i'); small.textContent = `${layer.cal} kcal`;
            text.append(b, small);
            el.append(dot, line, text);
            this.labelsEl.appendChild(el);
            this.labelEls.push({ el, layer, left });
        });
    }

    _updateLabels() {
        if (!this.labelEls.length || !this.model) return;
        const show = smoothstep(this.state.explode, 0.5, 0.92) * (this.width >= 420 ? 1 : 0);
        if (show <= 0.001) {
            if (!this._labelsHidden) { this.labelEls.forEach(({ el }) => { el.style.opacity = '0'; }); this._labelsHidden = true; }
            return;
        }
        this._labelsHidden = false;
        const cam = this.camera;
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        const p = new THREE.Vector3();
        const edge = new THREE.Vector3();
        const radius = this.model.radius;
        this.labelEls.forEach(({ el, layer, left }) => {
            layer.holder.localToWorld(p.set(0, Math.min(layer.h, 0.3) * 0.5, 0));
            edge.copy(p).addScaledVector(right, left ? -radius : radius);
            p.project(cam);
            edge.project(cam);
            let x = (edge.x * 0.5 + 0.5) * this.width + (left ? -10 : 10);
            const y = (-p.y * 0.5 + 0.5) * this.height;
            // keep every label fully inside the stage
            const w = el.offsetWidth || 150;
            x = left ? Math.max(x, w + 6) : Math.min(x, this.width - w - 6);
            el.style.opacity = String(show);
            el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(${left ? '-100%' : '0'}, -50%)`;
        });
    }

    /* ── frame loop ────────────────────────────────────────────────────── */
    _start() {
        if (this.running) return;
        this.running = true;
        this.clock.getDelta();
        const loop = () => {
            if (!this.running) return;
            this._frame();
            this._raf = requestAnimationFrame(loop);
        };
        this._raf = requestAnimationFrame(loop);
    }

    _stop() {
        this.running = false;
        cancelAnimationFrame(this._raf);
    }

    _resize() {
        const w = Math.max(1, this.el.clientWidth);
        const h = Math.max(1, this.el.clientHeight);
        this.width = w;
        this.height = h;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    _fitDistance(fitW, fitH) {
        const vFov = THREE.MathUtils.degToRad(this.camera.fov);
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
        const dH = (fitH / 2) / Math.tan(vFov / 2);
        const dW = (fitW / 2) / Math.tan(hFov / 2);
        const margin = this.mode.margin * (this.width < 520 ? 1.18 : 1); // breathing room on phones
        return Math.max(dH, dW) * margin + fitW * 0.3;
    }

    _frame() {
        const dt = Math.min(this.clock.getDelta(), 0.05);
        const t = this.clock.elapsedTime;
        const s = this.state;
        const now = performance.now();
        this.tweens.update(dt);

        // rotation: drag → inertia → idle auto-spin
        if (!s.dragging) {
            s.rotY += s.velY;
            s.velY *= 0.93;
            if (!reducedMotion && now - s.lastInteract > 2200) s.rotY += this.mode.autoSpin * dt;
        }
        this.spin.rotation.y = s.rotY;
        const modelTilt = this.model ? this.model.tilt : this.tilt.userData.lastTilt || 0;
        this.tilt.userData.lastTilt = modelTilt;
        this.tilt.rotation.x = damp(this.tilt.rotation.x, modelTilt + s.rotX + (s.dragging ? 0 : s.hoverY * 0.06), 8, dt);

        // explode amount: button toggle, hero scroll, or a gentle "breathing" loop on the auth page
        let target = Math.max(s.explodeToggle, s.scrollExplode);
        if (this.modeName === 'float' && !reducedMotion) target = Math.max(target, ((Math.sin(t * 0.65 - Math.PI / 2) + 1) / 2) * 0.5);
        s.explode = damp(s.explode, target, 5, dt);
        const e = s.explode;

        if (this.model) {
            const m = this.model;
            m.layers.forEach((layer) => {
                const y = lerp(layer.baseY, layer.explodedY, e) + (layer.drop || 0);
                layer.holder.position.y = y;
                layer.holder.rotation.y = layer.spin * e;
                const pop = layer.pop === undefined ? 1 : Math.max(0.001, layer.pop);
                layer.holder.scale.setScalar(pop);
            });
            const h = lerp(m.height, m.explodedHeight, e);
            this.center.position.y = -h / 2;

            const fitH = lerp(m.fit.h, m.fit.hExploded, e);
            const dist = this._fitDistance(m.fit.w, fitH);
            s.camX = damp(s.camX, (this.modeName === 'float' ? s.hoverX * 0.5 : 0), 3, dt);
            s.camY = damp(s.camY, (this.modeName === 'float' ? -s.hoverY * 0.3 : 0), 3, dt);
            // on narrow auth panels the copy sits below the burger, so lift it further
            const lookY = this.modeName === 'float' && this.width < 600 ? -2 : this.mode.lookY;
            this.camera.position.set(s.camX, dist * 0.2 + s.camY + lookY, dist);
            this.camera.lookAt(0, lookY, 0);

            // contact shadow grows softer as the stack opens up
            const blobY = -(this.modeName === 'float' ? m.fit.h * 0.62 : m.fit.h * 0.55) - e * 0.6;
            this.blob.position.y = blobY + this.root.position.y;
            const bs = (m.radius * 2.6) * (1 + e * 0.35);
            this.blob.scale.set(bs, bs, 1);
            this.blob.material.opacity = 0.85 - e * 0.45;
        }

        // floating bob
        this.root.position.y = reducedMotion ? 0 : Math.sin(t * 1.3) * this.mode.bob;

        // embers rise and loop
        if (this.embers) {
            const pos = this.embers.geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) {
                const d = this.emberData[i];
                let y = pos.getY(i) + d.speed * dt;
                if (y > 3.4) y = -2.6;
                pos.setY(i, y);
                pos.setX(i, pos.getX(i) + Math.sin(t * d.drift * 4 + d.phase) * 0.002);
            }
            pos.needsUpdate = true;
        }

        // orbiting ingredients
        if (this.bits.length) {
            const tmp = this._tmp || (this._tmp = new THREE.Vector3());
            this.bits.forEach((b) => {
                const a = b.phase + t * b.speed;
                tmp.set(Math.cos(a) * b.radius, b.y + Math.sin(a * 2 + b.phase) * 0.18, Math.sin(a) * b.radius);
                tmp.applyAxisAngle(X_AXIS, b.incline);
                b.obj.position.copy(tmp);
                b.obj.rotation.x += b.spin.x * dt;
                b.obj.rotation.y += b.spin.y * dt;
                b.obj.rotation.z += b.spin.z * dt;
            });
            this.bitGroup.rotation.y = s.rotY * 0.15;
        }

        this.camera.updateMatrixWorld();
        this._updateLabels();
        this.renderer.render(this.scene, this.camera);
    }
}

/* ── mount + page controls ──────────────────────────────────────────────── */
function stageFor(btn) {
    const target = btn.dataset.target ? document.querySelector(btn.dataset.target) : document.querySelector('[data-food3d]');
    return target && target.__food3d;
}

function mountAll() {
    document.querySelectorAll('[data-food3d]').forEach((el) => {
        if (el.__food3d) return;
        try {
            el.__food3d = new FoodStage(el);
        } catch (err) {
            console.warn('[BiteBuddy 3D] WebGL unavailable, showing image instead.', err);
        }
    });

    document.querySelectorAll('[data-food3d-switch]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const stage = stageFor(btn);
            const kind = btn.dataset.food3dSwitch;
            const seg = btn.closest('.bb-segment');
            if (seg) {
                seg.querySelectorAll('button').forEach((b) => { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
                if (window.BB && window.BB.syncSegment) window.BB.syncSegment(seg);
            }
            if (stage && (!stage.model || stage.model.kind !== kind)) stage.setModel(kind);
            const fallback = stage ? stage.el.querySelector('.bb3d__fallback') : null;
            if (fallback && btn.dataset.fallback) fallback.src = btn.dataset.fallback;
        });
    });

    document.querySelectorAll('[data-food3d-explode]').forEach((btn) => {
        const stage = stageFor(btn);
        if (!stage) { btn.hidden = true; return; }
        const label = btn.querySelector('[data-label]');
        const sync = (on) => {
            btn.setAttribute('aria-pressed', String(on));
            btn.classList.toggle('is-active', on);
            if (label) label.textContent = on ? (btn.dataset.labelOn || 'Stack it') : (btn.dataset.labelOff || 'Explode');
        };
        btn.addEventListener('click', () => sync(stage.toggleExplode()));
        stage.el.addEventListener('food3d:explode', (e) => sync(e.detail.on));
    });

    window.BB3D = Array.from(document.querySelectorAll('[data-food3d]')).map((el) => el.__food3d).filter(Boolean);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
else mountAll();
