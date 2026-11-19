/* ==========================================================================
   BiteBuddy — procedural 3D food models (three.js)
   Every model is built from code (no downloads) and split into layers so the
   stage can "explode" it. Each layer's local origin sits at its bottom (y = 0).
   ========================================================================== */
import * as THREE from 'three';

const TAU = Math.PI * 2;
const { clamp, smoothstep, lerp } = THREE.MathUtils;

/* ── Helpers ────────────────────────────────────────────────────────────── */

/** Deterministic PRNG (mulberry32) so models look the same on every load. */
export function rng(seed = 1) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Smooth pseudo-noise in [-1, 1]: a sum of random directional sine waves. */
function smoothNoise(rand, waves = 6, scale = 1) {
    const ws = Array.from({ length: waves }, () => ({
        x: rand() * 2 - 1, y: rand() * 2 - 1, z: rand() * 2 - 1,
        f: (1 + rand() * 3) * scale, p: rand() * TAU, a: 0.4 + rand() * 0.6,
    }));
    const total = ws.reduce((s, w) => s + w.a, 0);
    return (x, y, z) => {
        let v = 0;
        for (const w of ws) v += w.a * Math.sin((w.x * x + w.y * y + w.z * z) * w.f + w.p);
        return v / total;
    };
}

const cache = new Map();
/** Textures/materials/geometries are shared between rebuilds; flag them so the stage never disposes them. */
function cached(key, make) {
    if (!cache.has(key)) {
        const value = make();
        if (value && value.userData) value.userData.shared = true;
        cache.set(key, value);
    }
    return cache.get(key);
}

function canvasTexture(size, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    draw(canvas.getContext('2d'), size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

function setVertexColors(geo, fn) {
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
        fn(c, pos.getX(i), pos.getY(i), pos.getZ(i), nor ? nor.getY(i) : 0);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Lathe profile for a disc with rounded bottom (rb) and top (rt) edges; bottom → top. */
function roundedProfile(r, h, rb, rt, steps = 8) {
    const pts = [new THREE.Vector2(0, 0)];
    for (let i = 0; i <= steps; i++) {
        const a = -Math.PI / 2 + (i / steps) * (Math.PI / 2);
        pts.push(new THREE.Vector2(r - rb + Math.cos(a) * rb, rb + Math.sin(a) * rb));
    }
    for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * (Math.PI / 2);
        pts.push(new THREE.Vector2(r - rt + Math.cos(a) * rt, h - rt + Math.sin(a) * rt));
    }
    pts.push(new THREE.Vector2(0, h));
    return pts;
}

function enableShadows(obj, cast = true, receive = true) {
    obj.traverse((o) => {
        if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; }
    });
    return obj;
}

/* ── Shared textures ────────────────────────────────────────────────────── */

const tex = {
    meat: () => cached('tex:meat', () => canvasTexture(512, (ctx, s) => {
        const r = rng(21);
        ctx.fillStyle = '#5a2b14';
        ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < 5200; i++) {
            const dark = r() < 0.55;
            ctx.fillStyle = dark ? `rgba(34,12,4,${0.25 + r() * 0.55})` : `rgba(150,78,40,${0.18 + r() * 0.4})`;
            ctx.beginPath();
            ctx.arc(r() * s, r() * s, 0.6 + r() * 3.2, 0, TAU);
            ctx.fill();
        }
    })),
    tomato: () => cached('tex:tomato', () => canvasTexture(256, (ctx, s) => {
        const r = rng(5);
        const c = s / 2;
        ctx.fillStyle = '#b71c1c'; ctx.beginPath(); ctx.arc(c, c, c, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.arc(c, c, c * 0.9, 0, TAU); ctx.fill();
        for (let k = 0; k < 5; k++) {
            const a = (k / 5) * TAU + 0.3;
            ctx.save();
            ctx.translate(c + Math.cos(a) * c * 0.5, c + Math.sin(a) * c * 0.5);
            ctx.rotate(a);
            const g = ctx.createRadialGradient(0, 0, 2, 0, 0, c * 0.28);
            g.addColorStop(0, '#ffab91'); g.addColorStop(1, '#ff7059');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.ellipse(0, 0, c * 0.27, c * 0.18, 0, 0, TAU); ctx.fill();
            ctx.fillStyle = '#fff1b5';
            for (let j = 0; j < 7; j++) {
                ctx.beginPath();
                ctx.ellipse((r() - 0.5) * c * 0.32, (r() - 0.5) * c * 0.2, 3.2, 2, r() * 3, 0, TAU);
                ctx.fill();
            }
            ctx.restore();
        }
        ctx.fillStyle = '#f0625a'; ctx.beginPath(); ctx.arc(c, c, c * 0.17, 0, TAU); ctx.fill();
    })),
    bacon: () => cached('tex:bacon', () => canvasTexture(256, (ctx, s) => {
        const r = rng(9);
        const g = ctx.createLinearGradient(0, 0, 0, s);
        [[0, '#7c2016'], [0.16, '#b83c2e'], [0.3, '#f1c8ac'], [0.42, '#a3332a'], [0.58, '#e6b296'], [0.72, '#9a2e23'], [0.88, '#c9563f'], [1, '#6e1b12']]
            .forEach(([o, col]) => g.addColorStop(o, col));
        ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < 900; i++) {
            ctx.fillStyle = r() < 0.5 ? `rgba(60,10,5,${r() * 0.35})` : `rgba(255,220,200,${r() * 0.25})`;
            ctx.fillRect(r() * s, r() * s, 2 + r() * 14, 1 + r() * 2);
        }
    })),
    pepperoni: () => cached('tex:pepperoni', () => canvasTexture(128, (ctx, s) => {
        const r = rng(13);
        const c = s / 2;
        const g = ctx.createRadialGradient(c, c, c * 0.2, c, c, c);
        g.addColorStop(0, '#c62f27'); g.addColorStop(0.8, '#a3201b'); g.addColorStop(1, '#5c0f0b');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, c, 0, TAU); ctx.fill();
        for (let i = 0; i < 26; i++) {
            ctx.fillStyle = r() < 0.6 ? `rgba(240,140,120,${0.35 + r() * 0.35})` : `rgba(70,8,6,${0.3 + r() * 0.4})`;
            ctx.beginPath(); ctx.arc(c + (r() - 0.5) * c * 1.4, c + (r() - 0.5) * c * 1.4, 1.5 + r() * 4, 0, TAU); ctx.fill();
        }
    })),
    cheeseTop: () => cached('tex:cheese', () => canvasTexture(512, (ctx, s) => {
        const r = rng(3);
        ctx.fillStyle = '#ffd36a'; ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < 70; i++) {
            const x = r() * s; const y = r() * s; const rad = 10 + r() * 34;
            const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
            g.addColorStop(0, `rgba(196,112,34,${0.35 + r() * 0.4})`);
            g.addColorStop(0.6, 'rgba(230,160,60,.15)');
            g.addColorStop(1, 'rgba(255,211,106,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
        }
        for (let i = 0; i < 120; i++) {
            ctx.fillStyle = `rgba(255,248,210,${r() * 0.5})`;
            ctx.beginPath(); ctx.arc(r() * s, r() * s, 2 + r() * 8, 0, TAU); ctx.fill();
        }
    })),
};

/* ── Shared materials ───────────────────────────────────────────────────── */

const mat = {
    bun: () => cached('mat:bun', () => new THREE.MeshPhysicalMaterial({
        vertexColors: true, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.45,
        sheen: 0.8, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ffd7a0'),
    })),
    seed: () => cached('mat:seed', () => new THREE.MeshStandardMaterial({ color: '#fbefd2', roughness: 0.5 })),
    meat: () => cached('mat:meat', () => new THREE.MeshStandardMaterial({
        map: tex.meat(), bumpMap: tex.meat(), bumpScale: 1.6, roughness: 0.78,
    })),
    cheese: () => cached('mat:cheese', () => new THREE.MeshPhysicalMaterial({
        color: '#ffb22e', roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.22,
        sheen: 0.4, sheenColor: new THREE.Color('#fff1b8'),
    })),
    lettuce: () => cached('mat:lettuce', () => new THREE.MeshPhysicalMaterial({
        vertexColors: true, side: THREE.DoubleSide, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4,
        sheen: 0.5, sheenColor: new THREE.Color('#d8ffb0'),
    })),
    tomatoSide: () => cached('mat:tomatoSide', () => new THREE.MeshPhysicalMaterial({ color: '#b3171b', roughness: 0.28, clearcoat: 0.7 })),
    tomatoCap: () => cached('mat:tomatoCap', () => new THREE.MeshPhysicalMaterial({ map: tex.tomato(), roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.12 })),
    onion: () => cached('mat:onion', () => new THREE.MeshPhysicalMaterial({
        color: '#dcb0dc', roughness: 0.28, clearcoat: 0.6, transparent: true, opacity: 0.94,
    })),
    bacon: () => cached('mat:bacon', () => new THREE.MeshPhysicalMaterial({
        map: tex.bacon(), side: THREE.DoubleSide, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3,
    })),
    dough: () => cached('mat:dough', () => new THREE.MeshPhysicalMaterial({
        vertexColors: true, roughness: 0.7, sheen: 0.4, sheenColor: new THREE.Color('#ffd59a'),
    })),
    sauce: () => cached('mat:sauce', () => new THREE.MeshPhysicalMaterial({
        color: '#a8201a', roughness: 0.4, clearcoat: 0.6, side: THREE.DoubleSide,
    })),
    pizzaCheese: () => cached('mat:pizzaCheese', () => new THREE.MeshPhysicalMaterial({
        map: tex.cheeseTop(), roughness: 0.36, clearcoat: 0.55, clearcoatRoughness: 0.3, side: THREE.DoubleSide,
    })),
    pepperoniSide: () => cached('mat:pepSide', () => new THREE.MeshStandardMaterial({ color: '#6e130f', roughness: 0.5 })),
    pepperoniCap: () => cached('mat:pepCap', () => new THREE.MeshPhysicalMaterial({ map: tex.pepperoni(), roughness: 0.35, clearcoat: 0.6 })),
    basil: () => cached('mat:basil', () => new THREE.MeshPhysicalMaterial({ color: '#2f8f3a', roughness: 0.35, clearcoat: 0.6, side: THREE.DoubleSide })),
    olive: () => cached('mat:olive', () => new THREE.MeshPhysicalMaterial({ color: '#151515', roughness: 0.2, clearcoat: 1 })),
};

/* ── Burger parts ───────────────────────────────────────────────────────── */

function bunBottom(rand, q) {
    const geo = new THREE.LatheGeometry(roundedProfile(1.18, 0.4, 0.2, 0.06, 10), q.radial);
    const n = smoothNoise(rand, 5, 3);
    const crustTop = new THREE.Color('#eaa75a');
    const crustLow = new THREE.Color('#b8692a');
    const crumb = new THREE.Color('#f4dcae');
    setVertexColors(geo, (c, x, y, z, ny) => {
        if (ny > 0.8 && y > 0.36) c.copy(crumb).multiplyScalar(0.93 + n(x * 3, y, z * 3) * 0.07);
        else c.lerpColors(crustLow, crustTop, clamp(y / 0.4, 0, 1)).multiplyScalar(0.92 + n(x * 2, y * 2, z * 2) * 0.08);
    });
    return new THREE.Mesh(geo, mat.bun());
}

function bunTop(rand, q) {
    const r = 1.22; const hb = 0.12; const hd = 0.8;
    const pts = [new THREE.Vector2(0, 0)];
    for (let i = 0; i <= 8; i++) {
        const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
        pts.push(new THREE.Vector2(r - 0.12 + Math.cos(a) * 0.12, 0.12 + Math.sin(a) * 0.12));
    }
    for (let i = 1; i <= 30; i++) {
        const t = (i / 30) * (Math.PI / 2);
        pts.push(new THREE.Vector2(i === 30 ? 0 : r * Math.cos(t), hb + hd * Math.pow(Math.sin(t), 0.82)));
    }
    const geo = new THREE.LatheGeometry(pts, q.radial);
    const n = smoothNoise(rand, 6, 3);
    const crumb = new THREE.Color('#f4dcae');
    const base = new THREE.Color('#f2c27d');
    const mid = new THREE.Color('#da8a3c');
    const top = new THREE.Color('#a9521a');
    setVertexColors(geo, (c, x, y, z, ny) => {
        if (ny < -0.6) { c.copy(crumb); return; }
        const t = clamp((y - hb) / hd, 0, 1);
        if (t < 0.35) c.lerpColors(base, mid, t / 0.35);
        else c.lerpColors(mid, top, (t - 0.35) / 0.65);
        c.multiplyScalar(0.9 + n(x * 2.5, y * 2.5, z * 2.5) * 0.1);
    });
    const bun = new THREE.Mesh(geo, mat.bun());

    // sesame seeds: area-uniform on the dome, lying flat along the surface
    const count = q.seeds;
    const seedGeo = cached('geo:seed', () => new THREE.SphereGeometry(1, 10, 6));
    const seeds = new THREE.InstancedMesh(seedGeo, mat.seed(), count);
    const m = new THREE.Matrix4();
    const qn = new THREE.Quaternion();
    const twist = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3(0.03, 0.012, 0.058);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let k = 0; k < count; k++) {
        const u = (k + 0.5) / count;
        const t = Math.asin(0.28 + 0.7 * u);
        const th = k * golden + rand() * 0.3;
        const cx = r * Math.cos(t);
        p.set(cx * Math.cos(th), hb + hd * Math.pow(Math.sin(t), 0.82), cx * Math.sin(th));
        nrm.set(p.x / (r * r), (p.y - hb) / (hd * hd), p.z / (r * r)).normalize();
        p.addScaledVector(nrm, 0.008);
        qn.setFromUnitVectors(up, nrm);
        twist.setFromAxisAngle(nrm, rand() * TAU);
        qn.premultiply(twist);
        seeds.setMatrixAt(k, m.compose(p, qn, scale));
    }
    const g = new THREE.Group();
    g.add(bun, seeds);
    seeds.castShadow = false;
    return g;
}

function patty(rand, q) {
    const geo = new THREE.LatheGeometry(roundedProfile(1.24, 0.34, 0.13, 0.13, 8), q.radial);
    const n = smoothNoise(rand, 7, 4);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
        const d = n(x, y, z);
        const k = 1 + d * 0.035;
        pos.setXYZ(i, x * k, y + d * 0.03 * (y / 0.34), z * k);
    }
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat.meat());
}

function cheeseSlice(rand) {
    const geo = new THREE.BoxGeometry(2.3, 0.05, 2.3, 36, 1, 36);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i); const z = pos.getZ(i);
        const over = Math.max(0, Math.hypot(x, z) - 1.0);
        pos.setY(i, pos.getY(i) - over * over * 1.05 - over * 0.05 + Math.sin(x * 3 + z * 2) * 0.008);
    }
    geo.computeVertexNormals();
    geo.translate(0, 0.025, 0);
    const mesh = new THREE.Mesh(geo, mat.cheese());
    mesh.rotation.y = Math.PI / 4 + (rand() - 0.5) * 0.5;
    return mesh;
}

function lettuceLeaf(rand, q, radius = 1.45) {
    const geo = new THREE.RingGeometry(0.0001, radius, q.ring, 10);
    geo.rotateX(-Math.PI / 2);
    const n = smoothNoise(rand, 5, 2);
    const pos = geo.attributes.position;
    const phase = rand() * TAU;
    const amp = radius / 1.45; // small leaves get proportionally gentler ruffles
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i); const z = pos.getZ(i);
        const rad = Math.hypot(x, z);
        const th = Math.atan2(z, x);
        const edge = smoothstep(rad, radius * 0.58, radius);
        const ruffle = (Math.sin(th * 13 + phase + n(x, 0, z) * 3) * 0.075 + Math.sin(th * 29) * 0.025) * amp;
        const rr = rad * (1 + edge * (Math.sin(th * 7 + phase) * 0.06 + n(x * 2, 1, z * 2) * 0.05));
        pos.setXYZ(i, Math.cos(th) * rr, edge * ruffle - edge * edge * 0.16 * amp, Math.sin(th) * rr);
    }
    geo.computeVertexNormals();
    const inner = new THREE.Color('#d4ec9a');
    const outer = new THREE.Color('#2e8b37');
    setVertexColors(geo, (c, x, y, z) => {
        const t = smoothstep(Math.hypot(x, z), 0.2, radius * 1.05);
        c.lerpColors(inner, outer, t).multiplyScalar(0.9 + n(x * 4, 2, z * 4) * 0.12);
    });
    return new THREE.Mesh(geo, mat.lettuce());
}

function lettuce(rand, q) {
    const g = new THREE.Group();
    const a = lettuceLeaf(rand, q, 1.45);
    const b = lettuceLeaf(rand, q, 1.36);
    b.position.y = 0.025;
    b.rotation.y = 0.7;
    g.add(a, b);
    g.position.y = 0.02;
    const wrap = new THREE.Group();
    wrap.add(g);
    return wrap;
}

function tomatoSlices(rand) {
    const g = new THREE.Group();
    const geo = cached('geo:tomato', () => new THREE.CylinderGeometry(0.48, 0.48, 0.09, 40));
    const mats = [mat.tomatoSide(), mat.tomatoCap(), mat.tomatoCap()];
    for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU + rand() * 0.4;
        const s = new THREE.Mesh(geo, mats);
        s.position.set(Math.cos(a) * 0.5, 0.045 + k * 0.006, Math.sin(a) * 0.5);
        s.rotation.set((rand() - 0.5) * 0.08, rand() * TAU, (rand() - 0.5) * 0.08);
        g.add(s);
    }
    return g;
}

function onionRings(rand) {
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) {
        const R = 0.3 + rand() * 0.16;
        const cx = (rand() - 0.5) * 1.1;
        const cz = (rand() - 0.5) * 1.1;
        [1, 0.72].forEach((f) => {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(R * f, 0.03, 10, 56), mat.onion());
            ring.rotation.x = Math.PI / 2;
            ring.position.set(cx, 0.03 + rand() * 0.02, cz);
            g.add(ring);
        });
    }
    return g;
}

function baconStrips(rand) {
    const g = new THREE.Group();
    [0.55, -0.65].forEach((rot, k) => {
        const geo = new THREE.PlaneGeometry(2.15, 0.34, 80, 6);
        geo.rotateX(-Math.PI / 2);
        const pos = geo.attributes.position;
        const ph = rand() * TAU;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            pos.setY(i, 0.035 + Math.sin(x * 5.5 + ph) * 0.045 + Math.sin(x * 11 + ph) * 0.012 - Math.max(0, Math.abs(x) - 0.9) ** 2 * 0.5);
            pos.setZ(i, pos.getZ(i) + Math.sin(x * 3 + ph) * 0.05);
        }
        geo.computeVertexNormals();
        const strip = new THREE.Mesh(geo, mat.bacon());
        strip.rotation.y = rot;
        strip.position.set((k - 0.5) * 0.25, k * 0.02, (k - 0.5) * -0.2);
        g.add(strip);
    });
    return g;
}

/* ── Pizza parts ────────────────────────────────────────────────────────── */

const PIZZA_R = 1.75;

function pizzaDough(rand, q) {
    const R = PIZZA_R;
    const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(R - 0.16, 0)];
    for (let i = 1; i <= 24; i++) {
        const a = -Math.PI / 2 + (i / 24) * (Math.PI * 1.5);
        pts.push(new THREE.Vector2(R - 0.16 + Math.cos(a) * 0.15, 0.15 + Math.sin(a) * 0.15));
    }
    pts.push(new THREE.Vector2(R - 0.36, 0.1), new THREE.Vector2(0, 0.1));
    const geo = new THREE.LatheGeometry(pts, q.radial + 16);
    const n = smoothNoise(rand, 7, 4);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
        const rad = Math.hypot(x, z);
        if (rad > R - 0.4) {
            const d = n(x, y * 2, z);
            const k = 1 + d * 0.018;
            pos.setXYZ(i, x * k, y > 0.12 ? y + d * 0.035 : y, z * k);
        }
    }
    geo.computeVertexNormals();
    const top = new THREE.Color('#c7792f');
    const side = new THREE.Color('#e8b46c');
    const flat = new THREE.Color('#f1d398');
    const char = new THREE.Color('#6b3410');
    const under = new THREE.Color('#c88b45');
    setVertexColors(geo, (c, x, y, z, ny) => {
        const rad = Math.hypot(x, z);
        const d = n(x * 3, y * 3, z * 3);
        if (ny < -0.5) c.copy(under).multiplyScalar(0.85 + d * 0.15);
        else if (rad < R - 0.38) c.copy(flat);
        else if (y > 0.2) c.lerpColors(top, char, smoothstep(d, 0.35, 0.8) * 0.8);
        else c.lerpColors(side, top, clamp((y - 0.05) / 0.2, 0, 1));
    });
    return new THREE.Mesh(geo, mat.dough());
}

function pizzaSauce(rand, q) {
    const R = PIZZA_R - 0.33;
    const geo = new THREE.RingGeometry(0.0001, R, q.ring, 4);
    geo.rotateX(-Math.PI / 2);
    const n = smoothNoise(rand, 4, 3);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i); const z = pos.getZ(i);
        const rad = Math.hypot(x, z);
        const th = Math.atan2(z, x);
        const k = 1 + (rad / R) * (Math.sin(th * 9) * 0.015 + n(x, 0, z) * 0.02);
        pos.setXYZ(i, x * k, 0.004, z * k);
    }
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat.sauce());
}

function pizzaCheese(rand, q) {
    const R = PIZZA_R - 0.4;
    const geo = new THREE.RingGeometry(0.0001, R, q.ring, 24);
    geo.rotateX(-Math.PI / 2);
    const n = smoothNoise(rand, 6, 3);
    const bubbles = Array.from({ length: 16 }, () => {
        const a = rand() * TAU; const d = Math.sqrt(rand()) * R * 0.9;
        return { x: Math.cos(a) * d, z: Math.sin(a) * d, s: 0.08 + rand() * 0.14, h: 0.02 + rand() * 0.035 };
    });
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i); const z = pos.getZ(i);
        const rad = Math.hypot(x, z);
        const th = Math.atan2(z, x);
        const edge = smoothstep(rad, R * 0.75, R);
        let y = 0.03 + n(x * 2, 0, z * 2) * 0.008;
        for (const b of bubbles) y += b.h * Math.exp(-((x - b.x) ** 2 + (z - b.z) ** 2) / (2 * b.s * b.s));
        y -= edge * 0.02;
        const rr = rad * (1 + edge * (Math.sin(th * 6 + 1.7) * 0.05 + n(x * 3, 1, z * 3) * 0.04));
        pos.setXYZ(i, Math.cos(th) * rr, y, Math.sin(th) * rr);
    }
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat.pizzaCheese());
}

function pepperoni(rand) {
    const g = new THREE.Group();
    const geo = cached('geo:pepperoni', () => new THREE.CylinderGeometry(0.21, 0.2, 0.035, 28));
    const mats = [mat.pepperoniSide(), mat.pepperoniCap(), mat.pepperoniCap()];
    const spots = [[0, 0]];
    for (let k = 0; k < 6; k++) spots.push([0.6, (k / 6) * TAU + 0.3]);
    for (let k = 0; k < 9; k++) spots.push([1.08, (k / 9) * TAU]);
    spots.forEach(([d, a]) => {
        const jd = d + (rand() - 0.5) * 0.08;
        const ja = a + (rand() - 0.5) * 0.15;
        const p = new THREE.Mesh(geo, mats);
        p.position.set(Math.cos(ja) * jd, 0.05, Math.sin(ja) * jd);
        p.rotation.set((rand() - 0.5) * 0.12, rand() * TAU, (rand() - 0.5) * 0.12);
        p.scale.setScalar(0.9 + rand() * 0.2);
        g.add(p);
    });
    return g;
}

function basilLeafGeo() {
    return cached('geo:basil', () => {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.bezierCurveTo(0.12, 0.06, 0.13, 0.24, 0, 0.36);
        shape.bezierCurveTo(-0.13, 0.24, -0.12, 0.06, 0, 0);
        const geo = new THREE.ShapeGeometry(shape, 10);
        geo.rotateX(-Math.PI / 2);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) pos.setY(i, -(pos.getX(i) ** 2) * 1.4 + Math.sin(-pos.getZ(i) * 6) * 0.01);
        geo.computeVertexNormals();
        return geo;
    });
}

function oliveGeo() {
    return cached('geo:olive', () => new THREE.TorusGeometry(0.065, 0.032, 10, 24));
}

function pizzaGarnish(rand) {
    const g = new THREE.Group();
    for (let k = 0; k < 6; k++) {
        const a = rand() * TAU; const d = 0.25 + rand() * 0.85;
        const leaf = new THREE.Mesh(basilLeafGeo(), mat.basil());
        leaf.position.set(Math.cos(a) * d, 0.035, Math.sin(a) * d);
        leaf.rotation.y = rand() * TAU;
        leaf.scale.setScalar(0.85 + rand() * 0.4);
        g.add(leaf);
    }
    for (let k = 0; k < 9; k++) {
        const a = rand() * TAU; const d = 0.2 + rand() * 0.95;
        const olive = new THREE.Mesh(oliveGeo(), mat.olive());
        olive.rotation.x = Math.PI / 2;
        olive.position.set(Math.cos(a) * d, 0.03, Math.sin(a) * d);
        g.add(olive);
    }
    return g;
}

/* ── Assembly ───────────────────────────────────────────────────────────── */

function quality(level) {
    return level === 'low'
        ? { radial: 48, ring: 96, seeds: 46 }
        : { radial: 80, ring: 160, seeds: 84 };
}

function stack(defs, spread) {
    const group = new THREE.Group();
    let y = 0;
    const layers = defs.map((d, i) => {
        const holder = new THREE.Group();
        holder.add(d.obj);
        group.add(holder);
        const layer = {
            ...d, holder, index: i,
            baseY: y,
            explodedY: y + i * spread,
            spin: (i % 2 ? 1 : -1) * (0.18 + (i % 3) * 0.08),
        };
        holder.position.y = layer.baseY;
        y += d.h;
        return layer;
    });
    return { group, layers, height: y, explodedHeight: y + (defs.length - 1) * spread };
}

/**
 * Build a layered burger.
 * @param {{extraCheese?: boolean, extraPatty?: boolean, quality?: 'high'|'low', seed?: number}} opts
 */
export function buildBurger(opts = {}) {
    const { extraCheese = false, extraPatty = false, seed = 7 } = opts;
    const q = quality(opts.quality);
    const rand = rng(seed);
    const defs = [
        { name: 'Toasted bun', cal: 130, color: '#eaa75a', obj: bunBottom(rand, q), h: 0.4 },
        { name: 'Crisp lettuce', cal: 5, color: '#7cc957', obj: lettuce(rand, q), h: 0.06 },
        { name: 'Smashed beef', cal: 290, color: '#9a4b23', obj: patty(rand, q), h: 0.34 },
        { name: 'Cheddar melt', cal: 110, color: '#ffb22e', obj: cheeseSlice(rand), h: 0.05 },
    ];
    if (extraPatty) defs.push({ name: 'Extra patty', cal: 290, color: '#9a4b23', obj: patty(rand, q), h: 0.34, isExtra: true });
    if (extraCheese) defs.push({ name: 'Extra cheddar', cal: 110, color: '#ffc93c', obj: cheeseSlice(rand), h: 0.05, isExtra: true });
    defs.push(
        { name: 'Smoky bacon', cal: 85, color: '#d0533f', obj: baconStrips(rand), h: 0.07 },
        { name: 'Vine tomato', cal: 10, color: '#ff4d3d', obj: tomatoSlices(rand), h: 0.1 },
        { name: 'Red onion', cal: 8, color: '#d9a3dd', obj: onionRings(rand), h: 0.06 },
        { name: 'Sesame bun', cal: 150, color: '#f2c27d', obj: bunTop(rand, q), h: 0.92 },
    );
    defs.forEach((d) => enableShadows(d.obj));
    const built = stack(defs, 0.42);
    return {
        kind: 'burger', ...built,
        tilt: 0,
        fit: { w: 3.0, h: built.height + 0.2, hExploded: built.explodedHeight + 0.3 },
        radius: 1.45,
        calories: defs.reduce((s, d) => s + d.cal, 0),
    };
}

/**
 * Build a layered pizza.
 * @param {{size?: number, quality?: 'high'|'low', seed?: number}} opts
 */
export function buildPizza(opts = {}) {
    const { size = 1, seed = 11 } = opts;
    const q = quality(opts.quality);
    const rand = rng(seed);
    const defs = [
        { name: 'Hand-tossed dough', cal: 520, color: '#e8b46c', obj: pizzaDough(rand, q), h: 0.1 },
        { name: 'San Marzano sauce', cal: 60, color: '#e53935', obj: pizzaSauce(rand, q), h: 0.005 },
        { name: 'Mozzarella', cal: 340, color: '#ffd36a', obj: pizzaCheese(rand, q), h: 0.02 },
        { name: 'Pepperoni', cal: 210, color: '#d0342c', obj: pepperoni(rand), h: 0.03 },
        { name: 'Basil & olives', cal: 25, color: '#4caf50', obj: pizzaGarnish(rand), h: 0.03 },
    ];
    defs.forEach((d) => enableShadows(d.obj));
    const built = stack(defs, 0.55);
    built.group.scale.setScalar(size);
    return {
        kind: 'pizza', ...built,
        tilt: 0.62,
        fit: { w: 3.8 * size, h: 2.5 * size, hExploded: 3.6 * size },
        radius: PIZZA_R * size,
        calories: defs.reduce((s, d) => s + d.cal, 0),
    };
}

/* ── Floating ingredient "bits" (orbit around the hero) ─────────────────── */

export function buildBit(kind, rand = Math.random) {
    let obj;
    switch (kind) {
    case 'tomato': {
        obj = new THREE.Mesh(cached('geo:tomato', () => new THREE.CylinderGeometry(0.48, 0.48, 0.09, 40)), [mat.tomatoSide(), mat.tomatoCap(), mat.tomatoCap()]);
        obj.scale.setScalar(0.42);
        break;
    }
    case 'lettuce': {
        obj = lettuceLeaf(rand, { ring: 64 }, 0.38);
        break;
    }
    case 'pepperoni': {
        obj = new THREE.Mesh(cached('geo:pepperoni', () => new THREE.CylinderGeometry(0.21, 0.2, 0.035, 28)), [mat.pepperoniSide(), mat.pepperoniCap(), mat.pepperoniCap()]);
        obj.scale.setScalar(0.85);
        break;
    }
    case 'basil': {
        obj = new THREE.Mesh(basilLeafGeo(), mat.basil());
        obj.scale.setScalar(0.9);
        break;
    }
    case 'cheese': {
        obj = new THREE.Mesh(cached('geo:cheeseCube', () => new THREE.BoxGeometry(0.17, 0.17, 0.17)), mat.cheese());
        break;
    }
    case 'onion': {
        obj = new THREE.Mesh(cached('geo:onionBit', () => new THREE.TorusGeometry(0.14, 0.028, 8, 32)), mat.onion());
        break;
    }
    case 'olive': {
        obj = new THREE.Mesh(oliveGeo(), mat.olive());
        obj.scale.setScalar(1.6);
        break;
    }
    default: { // sesame seed
        obj = new THREE.Mesh(cached('geo:seed', () => new THREE.SphereGeometry(1, 10, 6)), mat.seed());
        obj.scale.set(0.05, 0.022, 0.09);
    }
    }
    const holder = new THREE.Group();
    holder.add(obj);
    return holder;
}

export { lerp };
