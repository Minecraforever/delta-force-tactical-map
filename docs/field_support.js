/* 阵地支援 3D 预览
 * 依赖 map.html 传入 THREE/scene/heightAt/data；所有参数来自 data/field_support.json。
 * 只负责预览：落点、爆炸/烟幕范围、投放时序、来袭轨迹与载具空投模型。
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function createFieldSupport(options) {
  const { THREE, scene, heightAt, data, getMapCode, getMode } = options;
  const $ = (id) => document.getElementById(id);
  const ui = {
    skills: $('fsSkills'),
    vehicleRow: $('fsVehicleRow'),
    vehicle: $('fsVehicle'),
    azimuthRow: $('fsAzimuthRow'),
    azimuth: $('fsAzimuth'),
    azimuthV: $('fsAzimuthV'),
    zoneRow: $('fsZoneRow'),
    zoneRange: $('fsZoneRange'),
    zoneFull: $('fsZoneFull'),
    zoneKill: $('fsZoneKill'),
    place: $('fsPlace'),
    play: $('fsPlay'),
    stop: $('fsStop'),
    clear: $('fsClear'),
    time: $('fsTime'),
    timeV: $('fsTimeV'),
    params: $('fsParams'),
  };
  if (!ui.skills || !data?.skills) {
    return { isPlacing: () => false, placeAt: () => false, clear() {}, refresh() {} };
  }

  const skills = data.skills;
  const state = {
    skill: 'guided',
    center: null,
    placing: false,
    playing: false,
    staticView: true,
    t: 0,
    duration: 20,
    vehicleId: null,
    vehicleLoading: false,
    azimuth: 315,
  };
  const zoneDefaults = {
    guided: { a: false, b: false, c: false },
    thermobaric: { a: false, b: false, c: false },
    artillery: { a: false, b: false, c: false },
    smoke: { a: true, b: false, c: false },
  };
  const zoneState = {};
  const group = new THREE.Group();
  group.name = 'fieldSupportOverlay';
  scene.add(group);

  const objects = {
    rings: [],      // { mesh, visibleAt }
    impacts: [],    // { mesh, time, radius }
    smokes: [],     // { mesh, time, lifetime }
    missiles: [],   // { mesh, curve, impactTime } 或 { mesh, startY, impactTime }（齐射）
    vehicleRoot: null,
  };
  let duration = 20;
  let raf = 0;
  let lastNow = 0;
  let buildToken = 0;
  let vehicleManifest = null;
  let vehicleManifestPromise = null;
  const vehicleModelCache = new Map();
  const gltfCache = new Map();
  const textureCache = new Map();

  const tone = (hex) => new THREE.Color(hex || '#ff6b52');

  function makeBasicMaterial(color, opacity, side = THREE.DoubleSide) {
    return new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthTest: false, depthWrite: false, side,
    });
  }

  function addRing(radius, width, color, opacity, y = 0.35, visibleAt = 0) {
    const outer = Math.max(radius + width / 2, 0.2);
    const inner = Math.max(radius - width / 2, 0.05);
    const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 128), makeBasicMaterial(color, opacity));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.renderOrder = 60;
    group.add(mesh);
    objects.rings.push({ mesh, visibleAt });
    return mesh;
  }

  function addDisc(radius, color, opacity, y = 0.3, visibleAt = 0) {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 96), makeBasicMaterial(color, opacity));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.renderOrder = 55;
    group.add(mesh);
    objects.rings.push({ mesh, visibleAt });
    return mesh;
  }

  /* 制导导弹的伤害体积是球体：地面用 15→35 m 的渐变环带表示边缘衰减，
     上空用 Fresnel 边缘壳表示高度和球面边界；球心在落点，顶高 = 半径。 */
  function addGradientRing(innerRadius, outerRadius, color, y = 0.33, visibleAt = 0) {
    const inner = Math.max(0, Math.min(innerRadius, outerRadius - 0.1));
    const geometry = new THREE.RingGeometry(inner, outerRadius, 128, 1);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uInner: { value: inner },
        uOuter: { value: outerRadius },
      },
      vertexShader: `
        varying float vR;
        void main() {
          vR = length(position.xy);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uInner;
        uniform float uOuter;
        varying float vR;
        void main() {
          float t = clamp((vR - uInner) / max(uOuter - uInner, 0.001), 0.0, 1.0);
          gl_FragColor = vec4(uColor, mix(0.34, 0.015, t));
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.renderOrder = 56;
    group.add(mesh);
    objects.rings.push({ mesh, visibleAt });
    return mesh;
  }

  function addSphereSilhouette(radius, color, opacity, visibleAt = 0) {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = new THREE.Color(color).getStyle();
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
    ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: texture, transparent: true, opacity, depthTest: false, depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(radius * 2, radius * 2, 1);
    sprite.renderOrder = 59;
    group.add(sprite);
    objects.rings.push({ mesh: sprite, visibleAt });
  }

  /* 半透明球壳 + 屏幕轮廓环：球体有体积感，边界是清楚的一圈，不再是细网。 */
  function addSphereVolume(radius, color, opacity, silhouetteOpacity, visibleAt = 0) {
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 32, 20),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.FrontSide,
      }),
    );
    shell.renderOrder = 57;
    group.add(shell);
    objects.rings.push({ mesh: shell, visibleAt });
    addSphereSilhouette(radius, color, silhouetteOpacity, visibleAt);
  }

  function addHeightRuler(radius, color, visibleAt = 0) {
    const line = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, radius * 2, 6),
      makeBasicMaterial(color, 0.5),
    );
    line.position.y = 0;
    line.renderOrder = 59;
    group.add(line);
    objects.rings.push({ mesh: line, visibleAt });
    for (const y of [radius, -radius]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.2, 2.0, 32),
        makeBasicMaterial(color, 0.8),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = y;
      ring.renderOrder = 60;
      group.add(ring);
      objects.rings.push({ mesh: ring, visibleAt });
    }
  }

  function disposeObject(object) {
    object.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!material) continue;
        if (material.map) material.map.dispose();
        material.dispose();
      }
    });
  }

  function clearGroup() {
    buildToken++;
    for (const child of [...group.children]) {
      group.remove(child);
      if (child.userData.sharedModel) continue;
      disposeObject(child);
    }
    objects.rings.length = 0;
    objects.impacts.length = 0;
    objects.smokes.length = 0;
    objects.missiles.length = 0;
    objects.vehicleRoot = null;
  }

  function rng(seed) {
    let value = seed >>> 0;
    return () => {
      value = (value + 0x6D2B79F5) >>> 0;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function skillSeed(id) {
    return id.split('').reduce((acc, ch) => (acc * 131 + ch.charCodeAt(0)) >>> 0, 17) ^ 0x9e3779b9;
  }

  function scatter(count, areaRadius, extraOffset, seed, singleCenter = false) {
    if (singleCenter || count <= 1) return [{ x: 0, z: 0 }];
    const random = rng(seed);
    const points = [];
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * Math.max(0.1, areaRadius || 0.1)
        + random() * Math.max(0, extraOffset || 0);
      points.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
    }
    return points;
  }

  function loadVehicleManifest() {
    if (vehicleManifest) return Promise.resolve(vehicleManifest);
    if (!vehicleManifestPromise) {
      vehicleManifestPromise = fetch('./data/vehicle_models/vehicle_models.json')
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
        .then((doc) => { vehicleManifest = doc; return doc; });
    }
    return vehicleManifestPromise;
  }

  function loadGltfAsset(url) {
    if (!gltfCache.has(url)) {
      gltfCache.set(url, new GLTFLoader().loadAsync('./data/vehicle_models/' + url).catch(() => null));
    }
    return gltfCache.get(url);
  }

  function loadVehicleTexture(url) {
    if (!textureCache.has(url)) {
      textureCache.set(url, new THREE.TextureLoader().loadAsync('./data/vehicle_models/' + url)
        .then((texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.flipY = false;
          texture.anisotropy = 4;
          return texture;
        })
        .catch(() => null));
    }
    return textureCache.get(url);
  }

  async function applyVehicleMaterials(object, materials) {
    const mapping = materials || {};
    const jobs = [];
    object.traverse((child) => {
      if (!child.isMesh) return;
      const materialName = child.material?.name || '';
      const textureUrl = mapping[materialName];
      if (textureUrl) {
        jobs.push(loadVehicleTexture(textureUrl).then((texture) => {
          child.material = new THREE.MeshStandardMaterial({
            map: texture || null,
            color: texture ? 0xffffff : 0x8d99a8,
            metalness: 0.25,
            roughness: 0.7,
          });
          child.material.name = materialName;
        }));
      } else {
        child.material = new THREE.MeshStandardMaterial({ color: 0x8d99a8, metalness: 0.25, roughness: 0.7 });
        child.material.name = materialName;
      }
    });
    await Promise.all(jobs);
  }

  function placeVehicleObject(object, loc, quat, scale) {
    if (Array.isArray(loc)) object.position.set(loc[0] * 0.01, loc[2] * 0.01, loc[1] * 0.01);
    if (Array.isArray(quat)) object.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
    if (Array.isArray(scale)) object.scale.set(scale[0], scale[1], scale[2]);
  }

  async function buildVehicleModel(id) {
    const doc = await loadVehicleManifest();
    const def = doc?.vehicles?.[String(id)];
    if (!def) return null;
    const root = new THREE.Group();
    await Promise.all((def.parts || []).map(async (part) => {
      const gltf = await loadGltfAsset(part.url);
      if (!gltf) return;
      const object = gltf.scene.clone(true);
      await applyVehicleMaterials(object, part.materials);
      placeVehicleObject(object, part.loc, part.quat, part.scale);
      root.add(object);
    }));
    for (const wheelDef of def.wheels || []) {
      const gltf = await loadGltfAsset(wheelDef.url);
      if (!gltf) continue;
      await applyVehicleMaterials(gltf.scene, wheelDef.materials);
      for (const transform of wheelDef.transforms || []) {
        const object = gltf.scene.clone(true);
        placeVehicleObject(object, transform.loc, transform.quat, transform.scale);
        root.add(object);
      }
    }
    const box = new THREE.Box3().setFromObject(root);
    if (Number.isFinite(box.min.y)) root.position.y = -box.min.y + 0.05;
    root.rotation.y = Math.PI * 0.75;
    root.userData.sharedModel = true;
    return root;
  }

  function getVehicleModel(id) {
    if (!vehicleModelCache.has(id)) vehicleModelCache.set(id, buildVehicleModel(id).catch(() => null));
    return vehicleModelCache.get(id).then((root) => (root ? root.clone(true) : null));
  }

  function addTrajectory(delivery, impactTime, accent, withShell = true) {
    const distance = delivery.fireDistance || 1000;
    const height = delivery.fireHeight || 1500;
    const azimuth = (state.azimuth % 360) * Math.PI / 180;
    const dx = Math.cos(azimuth) * distance;
    const dz = Math.sin(azimuth) * distance;
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(dx, height, dz),
      new THREE.Vector3(dx * 0.22, height * 0.55, dz * 0.22),
      new THREE.Vector3(0, 0, 0),
    );
    const arc = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 64, 0.6, 6, false),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.52, depthTest: false }),
    );
    arc.renderOrder = 64;
    group.add(arc);
    const ground = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(dx, 0.7, dz), new THREE.Vector3(0, 0.7, 0),
      ]),
      new THREE.LineDashedMaterial({
        color: accent, transparent: true, opacity: 0.55, dashSize: 18, gapSize: 12, depthTest: false,
      }),
    );
    ground.computeLineDistances();
    ground.renderOrder = 63;
    group.add(ground);
    const launch = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.4, 48), makeBasicMaterial(accent, 0.85));
    launch.rotation.x = -Math.PI / 2;
    launch.position.set(dx, 0.75, dz);
    launch.renderOrder = 64;
    group.add(launch);
    if (withShell) {
      const shell = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd0a0 }));
      shell.renderOrder = 67;
      group.add(shell);
      objects.missiles.push({ mesh: shell, curve, impactTime });
    }
    return curve;
  }

  function build() {
    clearGroup();
    if (!state.center) return;
    const skill = skills[state.skill];
    if (!skill) return;
    const cx = state.center.x;
    const cy = state.center.y;
    const cz = state.center.z;
    const accent = skill.tone || '#ff6b52';
    group.position.set(cx, cy, cz);

    // 中心标记（空投载具不画，避免遮挡模型）
    if (skill.kind !== 'airdrop') {
      addRing(2.6, 0.5, 0xffffff, 0.9, 0.4);
      addRing(1.2, 0.35, accent, 0.95, 0.45);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 22, 8, 1, true),
        makeBasicMaterial(accent, 0.55),
      );
      beam.position.y = 11;
      beam.renderOrder = 50;
      group.add(beam);
    }

    const blast = skill.blast || {};
    const delivery = skill.delivery || {};
    const zones = currentZones();
    const count = delivery.count || 1;
    const impactTimes = [];

    if (skill.kind === 'salvo') {
      const first = (delivery.fireDelay || 0) + (delivery.flyTime || 0);
      const interval = delivery.fireInterval || 0;
      for (let i = 0; i < count; i++) impactTimes.push(first + i * interval);
    } else if (skill.kind === 'smoke') {
      const first = (delivery.fireDelay || 0) + (delivery.flyTime || 0);
      for (let i = 0; i < count; i++) impactTimes.push(first + i * (delivery.fireInterval || 0));
    } else if (skill.kind === 'missile' || skill.kind === 'thermobaric') {
      impactTimes.push(delivery.flyTime || 0);
    } else if (skill.kind === 'airdrop') {
      const air = skill.airdrop || {};
      const dropTime = Number(air.dropTime) || 12;
      impactTimes.push(dropTime + vehicleFallTime(air));
    }

    // 范围圈：齐射/烟雾的覆盖范围（始终显示，不占用显示按钮）
    if ((skill.kind === 'salvo' || skill.kind === 'smoke') && delivery.areaRadius) {
      addDisc(delivery.areaRadius, tone(accent), 0.06, 0.25);
      addRing(delivery.areaRadius, 0.6, accent, 0.85, 0.3);
    }
    const missileLike = skill.kind === 'missile' || skill.kind === 'thermobaric';
    if (blast.radius) {
      const impactAt = missileLike ? impactTimes[0] : 0;
      if (skill.id === 'guided') {
        const killRadius = radiusForDamage(blast, 100);
        addSphereVolume(blast.radius, 0xff5a45, 0.022, 0.85, impactAt);
        addRing(blast.radius, 0.8, 0xff5a45, 0.9, 0.32, impactAt);
        if (zones.a && blast.fullRadius) {
          addSphereVolume(blast.fullRadius, 0xffb347, 0.03, 0.9, impactAt);
          addRing(blast.fullRadius, 0.6, 0xffb347, 0.95, 0.34, impactAt);
        }
        if (zones.b && killRadius) {
          addSphereVolume(killRadius, 0xffd166, 0.03, 0.95, impactAt);
          addRing(killRadius, 0.7, 0xffd166, 0.95, 0.36, impactAt);
        }
        addHeightRuler(blast.radius, 0xffb347, impactAt);
      } else if (skill.kind === 'thermobaric') {
        const killRadius = radiusForDamage(blast, 100);
        addDisc(blast.radius, 0xff4d2e, 0.08, 0.26, impactAt);
        addRing(blast.radius, 0.8, 0xff5a45, 0.9, 0.32, impactAt);
        if (zones.a && blast.fullRadius) addRing(blast.fullRadius, 0.55, 0xffb347, 0.95, 0.36, impactAt);
        if (zones.b && killRadius) addRing(killRadius, 0.5, 0xffd166, 0.95, 0.38, impactAt);
      }
      // 炮兵齐射不在中心画单发爆炸，改为每个落点单独画（见下面的 impact 标记）
    }
    if (skill.kind === 'thermobaric') {
      const dot = skill.special?.dotRadius || 0;
      const delay = skill.special?.dotDelay || 0;
      if (dot) {
        addDisc(dot, 0xff7a2f, 0.1, 0.22, impactTimes[0] + delay);
        addRing(dot, 0.7, 0xffa040, 0.8, 0.3, impactTimes[0] + delay);
      }
    }
    if (skill.kind === 'airdrop') {
      addDisc(8, 0xffd166, 0.08, 0.25);
      addRing(8, 0.6, 0xffd166, 0.9, 0.3);
    }

    // 落点散佈（空投只保留落区圈，中心不放爆炸标记）
    const points = scatter(count, delivery.areaRadius, delivery.extraOffset, skillSeed(skill.id), missileLike);
    const salvoKillRadius = skill.kind === 'salvo' ? radiusForDamage(blast, 100) : 0;
    const impactList = [];
    if (skill.kind !== 'airdrop') {
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const marker = new THREE.Group();
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.9, 1.45, 40),
          makeBasicMaterial(i === 0 ? 0xffffff : 0xffc46b, 0.9),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.4;
        ring.renderOrder = 65;
        const dot = new THREE.Mesh(
          new THREE.CircleGeometry(0.45, 16),
          makeBasicMaterial(0xff6b45, 0.95),
        );
        dot.rotation.x = -Math.PI / 2;
        dot.position.y = 0.42;
        dot.renderOrder = 66;
        marker.add(ring, dot);
        if (skill.kind === 'salvo') {
          const addMarkerRing = (radius, width, color, opacity, y) => {
            const blastRing = new THREE.Mesh(
              new THREE.RingGeometry(Math.max(0.05, radius - width / 2), radius + width / 2, 48),
              makeBasicMaterial(color, opacity),
            );
            blastRing.rotation.x = -Math.PI / 2;
            blastRing.position.y = y;
            blastRing.renderOrder = 63;
            marker.add(blastRing);
          };
          if (zones.a && blast.fullRadius) addMarkerRing(blast.fullRadius, 0.32, 0xffd166, 0.9, 0.38);
          if (zones.b && salvoKillRadius) addMarkerRing(salvoKillRadius, 0.3, 0xffe066, 0.95, 0.41);
          if (zones.c && blast.radius) addMarkerRing(blast.radius, 0.5, 0xff8a5a, 0.8, 0.44);
        }
        marker.position.set(point.x, 0, point.z);
        group.add(marker);
        const item = { mesh: marker, time: impactTimes[i] ?? 0, radius: blast.radius || 0 };
        objects.impacts.push(item);
        impactList.push(item);
      }
    }

    if (missileLike) {
      addTrajectory(delivery, impactTimes[0] || 0, accent);
    } else if (skill.kind === 'salvo') {
      // 炮兵没有单发弹道模型，画一条代表性来袭弧线/方位线，仍可拖方位滑杆
      addTrajectory(delivery, impactTimes[0] || 0, accent, false);
    }

    if (skill.kind === 'salvo') {
      // 最近一发炮弹的下落标记；按时间轴取“正在落下”的一发
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(1.1, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffdf9a }),
      );
      shell.renderOrder = 67;
      group.add(shell);
      objects.missiles.push({
        mesh: shell, trail: null, startY: delivery.fireHeight || 600,
        impactTime: impactTimes[0], multiple: true, impactTimes, points,
      });
    }

    if (skill.kind === 'smoke' && zones.a) {
      const smokeInfo = skill.smoke || {};
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const cloud = new THREE.Mesh(
          new THREE.SphereGeometry(1, 18, 14),
          new THREE.MeshBasicMaterial({
            color: 0xd6dde6, transparent: true, opacity: 0.28,
            depthWrite: false, side: THREE.DoubleSide,
          }),
        );
        cloud.scale.set(smokeInfo.radius || 6, (smokeInfo.height || 4) / 2, smokeInfo.radius || 6);
        cloud.position.set(point.x, (smokeInfo.height || 4) / 2 + 0.4, point.z);
        cloud.renderOrder = 45;
        group.add(cloud);
        objects.smokes.push({ mesh: cloud, time: impactTimes[i] ?? 0, lifetime: smokeInfo.lifetime || 15 });
      }
    }

    if (skill.kind === 'airdrop') {
      const root = new THREE.Group();
      root.userData.sharedModel = true;
      group.add(root);
      objects.vehicleRoot = root;
      const token = buildToken;
      const placeholder = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, 2.2, 7.2),
        makeBasicMaterial(0xffd166, 0.35),
      );
      placeholder.position.y = 1.2;
      placeholder.renderOrder = 66;
      root.add(placeholder);
      state.vehicleLoading = true;
      getVehicleModel(state.vehicleId).then((model) => {
        if (token !== buildToken || !state.center || objects.vehicleRoot !== root) return;
        state.vehicleLoading = false;
        if (model) {
          root.remove(placeholder);
          placeholder.geometry.dispose();
          placeholder.material.dispose();
          root.add(model);
          applyTime(state.staticView ? Infinity : state.t);
        }
        updateSkillHint();
      });
    }

    duration = computeDuration(skill, impactTimes);
    state.duration = duration;
    state.t = Math.min(state.t, duration);
    ui.time.max = String(Math.ceil(duration));
    if (state.staticView) {
      ui.time.value = String(duration);
      ui.timeV.textContent = '全时段';
    }
    applyTime(state.staticView ? duration : state.t);
  }

  function computeDuration(skill, impactTimes) {
    const last = impactTimes.length ? Math.max(...impactTimes) : 0;
    if (skill.kind === 'smoke') return Math.ceil((last + (skill.smoke?.lifetime || 15) + 1) * 2) / 2;
    if (skill.kind === 'salvo') return Math.ceil(last + 4);
    if (skill.kind === 'airdrop') return Math.ceil(last + 3);
    if (skill.kind === 'thermobaric') return Math.ceil(last + 6);
    return Math.ceil(last + 3);
  }

  function clamp01(value) { return Math.min(1, Math.max(0, value)); }

  // 空投载具：伞降结束后从 vehicleFallingHeight 处自由落体到地面（g=9.8 m/s²）
  const FALL_GRAVITY = 9.8;
  function vehicleFallTime(airdrop) {
    const height = Number(airdrop?.vehicleFallingHeight) || 14.5;
    return Math.sqrt(Math.max(0, height) * 2 / FALL_GRAVITY);
  }

  function applyTime(t) {
    const skill = skills[state.skill];
    if (!skill) return;
    const staticView = state.staticView;
    const time = staticView ? Infinity : t;
    for (const item of objects.rings) {
      item.mesh.visible = time >= (item.visibleAt || 0);
      item.mesh.material.opacity = item.mesh.userData.baseOpacity ?? item.mesh.material.opacity;
    }
    // 记录基础透明度（第一次应用时）
    for (const item of objects.rings) {
      if (item.mesh.userData.baseOpacity == null) item.mesh.userData.baseOpacity = item.mesh.material.opacity;
    }
    for (const item of objects.impacts) {
      const age = time - item.time;
      const visible = staticView || (time >= item.time && time < item.time + 6);
      item.mesh.visible = visible;
      if (!visible) continue;
      const fresh = staticView ? 1 : clamp01(1 - Math.max(0, age) / 2.2);
      item.mesh.scale.setScalar(0.75 + (staticView ? 0 : (1 - fresh) * 0.8));
      item.mesh.traverse((node) => {
        if (node.material) node.material.opacity = staticView ? 0.85 : 0.35 + fresh * 0.6;
      });
    }
    for (const item of objects.smokes) {
      const age = time - item.time;
      const alive = staticView || (age >= 0 && age <= item.lifetime);
      item.mesh.visible = alive;
      if (!alive) continue;
      const fadeIn = staticView ? 1 : clamp01(age / 1.2);
      const fadeOut = staticView ? 1 : clamp01((item.lifetime - age) / 2);
      item.mesh.material.opacity = (staticView ? 0.28 : 0.42) * Math.min(fadeIn, fadeOut);
    }
    for (const item of objects.missiles) {
      if (item.curve) {
        const active = !staticView && time >= 0 && time <= item.impactTime;
        item.mesh.visible = active;
        if (active) {
          const ratio = clamp01(time / Math.max(0.1, item.impactTime));
          item.mesh.position.copy(item.curve.getPoint(ratio));
        }
        continue;
      }
      const active = !staticView && time >= 0 && time <= item.impactTime;
      item.mesh.visible = active;
      if (active) {
        const ratio = clamp01(time / Math.max(0.1, item.impactTime));
        item.mesh.position.y = item.startY * (1 - ratio);
      }
    }
    if (objects.vehicleRoot) {
      const skill = skills[state.skill] || {};
      const drop = skill.airdrop || {};
      const dropTime = Number(drop.dropTime) || 12;
      const spawnHeight = Number(drop.spawnHeight) || 80;
      const fallingHeight = Number(drop.vehicleFallingHeight) || 14.5;
      const fallTime = vehicleFallTime(drop);
      objects.vehicleRoot.visible = true;
      if (staticView || time >= dropTime + fallTime) {
        // 全时段定格或已落地
        objects.vehicleRoot.position.y = 0;
      } else if (time <= dropTime) {
        // 第一阶段：伞降，80 m → 14.5 m
        const ratio = Math.max(0, time) / Math.max(0.1, dropTime);
        objects.vehicleRoot.position.y = spawnHeight - (spawnHeight - fallingHeight) * ratio;
      } else {
        // 第二阶段：14.5 m 处脱离伞具，自由落体
        const dt = time - dropTime;
        objects.vehicleRoot.position.y = Math.max(0, fallingHeight - 0.5 * FALL_GRAVITY * dt * dt);
      }
    }
  }

  function showStatic() {
    state.staticView = true;
    state.playing = false;
    cancelAnimationFrame(raf);
    state.t = duration;
    ui.time.value = String(duration);
    ui.timeV.textContent = '全时段';
    applyTime(duration);
  }

  function play() {
    if (!state.center) { setHint('先点「选择落点」，在地图上放置一个落点。'); return; }
    state.staticView = false;
    state.playing = true;
    state.t = 0;
    lastNow = performance.now();
    ui.time.value = '0';
    ui.timeV.textContent = '0.0 s';
    setHint('预览中：炮弹飞行、落点出现和烟幕生成按时间轴播放；拖动滑块可定格。');
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function loop(now) {
    if (!state.playing) return;
    const dt = Math.min(0.2, (now - lastNow) / 1000);
    lastNow = now;
    state.t = Math.min(duration, state.t + dt);
    ui.time.value = String(state.t);
    ui.timeV.textContent = `${state.t.toFixed(1)} s`;
    applyTime(state.t);
    if (state.t >= duration) {
      state.playing = false;
      setHint('预览结束。可「播放预览」重放，或拖动时间轴定格。');
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    state.playing = false;
    cancelAnimationFrame(raf);
  }

  function setHint(text) { /* 提示框已移除，保留调用点避免改动交互逻辑 */ }

  function zoneConfigFor(skill) {
    if (!skill) return null;
    const b = skill.blast || {};
    const kill = radiusForDamage(b, 100);
    if (skill.id === 'guided') {
      return {
        a: { label: `满伤区 ${fmt(b.fullRadius, 'm')}` },
        b: kill ? { label: `斩杀线 ${fmt(kill, 'm')}` } : null,
        c: null,
      };
    }
    if (skill.id === 'thermobaric') {
      return {
        a: { label: `满伤区 ${fmt(b.fullRadius, 'm')}` },
        b: kill ? { label: `斩杀线 ${fmt(kill, 'm')}` } : null,
        c: null,
      };
    }
    if (skill.id === 'artillery') {
      return {
        a: { label: `满伤区 ${fmt(b.fullRadius, 'm')}` },
        b: kill ? { label: `斩杀线 ${fmt(kill, 'm')}` } : null,
        c: { label: `单发爆炸 ${fmt(b.radius, 'm')}` },
      };
    }
    if (skill.id === 'smoke') {
      return {
        a: { label: `烟幕团 ${fmt(skill.smoke?.radius, 'm')}` },
        b: null,
        c: null,
      };
    }
    return null;
  }

  function currentZones() {
    return zoneState[state.skill] || { a: false, b: false, c: false };
  }

  function radiusForDamage(blast, target) {
    const full = Number(blast?.fullRadius);
    const outer = Number(blast?.radius);
    const damage = Number(blast?.damage);
    const minDamage = Number(blast?.minDamage);
    if (!(full >= 0 && outer > full && damage > target && minDamage <= target)) return null;
    const t = (damage - target) / Math.max(0.0001, damage - minDamage);
    return full + Math.min(1, Math.max(0, t)) * (outer - full);
  }

  function fmt(value, unit = '', digits = null) {
    if (value == null || value === '') return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    const text = digits == null ? (Number.isInteger(number) ? String(number) : number.toFixed(1)) : number.toFixed(digits);
    return `${text}${unit}`;
  }

  function addRow(label, value) {
    if (value == null || value === '' || value === '—') return '';
    return `<tr><td>${label}</td><td>${value}</td></tr>`;
  }

  function addGroup(label) {
    return `<tr class="fsGroup"><td colspan="2">${label}</td></tr>`;
  }

  function renderParams() {
    const skill = skills[state.skill];
    if (!skill) return;
    const d = skill.delivery || {};
    const b = skill.blast || {};
    const sp = skill.special || {};
    const groups = [];
    const pushGroup = (label, groupRows) => {
      if (groupRows.length) groups.push(addGroup(label) + groupRows.join(''));
    };
    if (skill.kind === 'airdrop') {
      const air = skill.airdrop || {};
      const fallTime = vehicleFallTime(air);
      const dropRows = [
        addRow('空投高度', fmt(air.spawnHeight, ' m')),
        addRow('伞降时间', fmt(air.dropTime, ' s')),
        addRow('自由落体高度', fmt(air.vehicleFallingHeight, ' m')),
        addRow('自由落体时间', fmt(fallTime, ' s', 1)),
      ].filter(Boolean);
      pushGroup('空投', dropRows);
      const vehicleRows = [
        addRow('每阵营上限', '2 辆'),
        addRow('载具', skills.vehicle?.name && data.vehicleNames?.[String(state.vehicleId)] ? data.vehicleNames[String(state.vehicleId)] : '—'),
      ].filter(Boolean);
      pushGroup('载具', vehicleRows);
    } else {
      const deliveryRows = [
        addRow('投放数量', d.count ? `${d.count} 发` : '—'),
        d.areaRadius ? addRow('落点范围', `半径 ${fmt(d.areaRadius, ' m')}${d.extraOffset ? ` + ${fmt(d.extraOffset, ' m')} 随机` : ''}`) : '',
        d.fireDelay != null ? addRow('首发延迟', fmt(d.fireDelay, ' s')) : '',
        d.flyTime ? addRow('飞行时间', fmt(d.flyTime, ' s')) : '',
        d.fireHeight ? addRow('投放高度', fmt(d.fireHeight, ' m')) : '',
        d.fireDistance ? addRow('投放距离', fmt(d.fireDistance, ' m')) : '',
        d.fireInterval ? addRow('落点间隔', fmt(d.fireInterval, ' s')) : '',
      ];
      const first = (d.fireDelay || 0) + (d.flyTime || 0);
      const last = first + Math.max(0, (d.count || 1) - 1) * (d.fireInterval || 0);
      if (d.flyTime) deliveryRows.push(addRow('落地时段', `${fmt(first, ' s')} → ${fmt(last, ' s')}`));
      pushGroup('投放', deliveryRows.filter(Boolean));

      const hitRows = [];
      if (b.damage) hitRows.push(addRow('伤害（人）', `${fmt(b.damage)} → ${fmt(b.minDamage)}`));
      if (b.vehicleDamage) hitRows.push(addRow('伤害（载具）', `${fmt(b.vehicleDamage)} → ${fmt(b.minVehicleDamage)}`));
      if (b.throughBunker != null) hitRows.push(addRow('穿掩体', b.throughBunker ? `是 · 掩体倍率 ${fmt(b.bunkerRate)}` : `否 · 掩体倍率 ${fmt(b.bunkerRate)}`));
      if (sp.knockdownRadius) hitRows.push(addRow('击倒半径', fmt(sp.knockdownRadius, ' m')));
      if (sp.cameraShakeRadius) hitRows.push(addRow('镜头震动', fmt(sp.cameraShakeRadius, ' m')));
      if (sp.screenRadius) hitRows.push(addRow('屏幕效果', fmt(sp.screenRadius, ' m')));
      pushGroup('命中与伤害', hitRows.filter(Boolean));

      if (skill.smoke) {
        pushGroup('烟幕', [
          addRow('烟幕尺寸', `${fmt(skill.smoke.radius, ' m')} 半径 · ${fmt(skill.smoke.height, ' m')} 高`),
          addRow('烟幕持续', `${fmt(skill.smoke.lifetime, ' s')} · 贴地 ${fmt(skill.smoke.attachDown, ' m')}`),
        ].filter(Boolean));
      }
    }
    ui.params.innerHTML = groups.join('');
  }

  function currentMapId() {
    const code = String(getMapCode() || '').toLowerCase();
    const key = Object.keys(data.mapIds || {}).find((item) => item.toLowerCase() === code);
    return key ? data.mapIds[key] : null;
  }

  function refreshVehicles() {
    if (!ui.vehicle || !ui.vehicleRow) return;
    const mode = getMode();
    const mapId = currentMapId();
    const limits = (mode === 'commander' || mode === 'assault') && mapId != null
      ? data.airdropLimits?.[String(mapId)] : null;
    const previous = state.vehicleId;
    ui.vehicle.innerHTML = '';
    if (!limits) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = mode === 'conquest' || mode === 'tdm' ? '该模式没有空投载具表' : (mapId == null ? '该地图没有空投载具表' : '无空投载具数据');
      ui.vehicle.appendChild(option);
      ui.vehicle.disabled = true;
      state.vehicleId = null;
    } else {
      for (const id of limits.vehicles) {
        const option = document.createElement('option');
        option.value = String(id);
        option.textContent = data.vehicleNames?.[String(id)] || String(id);
        ui.vehicle.appendChild(option);
      }
      const wanted = previous && limits.vehicles.includes(Number(previous)) ? String(previous) : String(limits.vehicles[0]);
      ui.vehicle.value = wanted;
      ui.vehicle.disabled = false;
      state.vehicleId = Number(wanted);
    }
    ui.vehicleRow.hidden = state.skill !== 'vehicle';
    if (state.skill === 'vehicle' && state.center) build();
  }

  function syncZoneButtons() {
    if (!ui.zoneRow) return;
    const cfg = zoneConfigFor(skills[state.skill]);
    if (!cfg) {
      ui.zoneRow.hidden = true;
      return;
    }
    if (!zoneState[state.skill]) {
      zoneState[state.skill] = { ...(zoneDefaults[state.skill] || { a: true, b: false, c: false }) };
    }
    const zones = zoneState[state.skill];
    ui.zoneRow.hidden = false;
    ui.zoneRange.textContent = cfg.a.label;
    ui.zoneRange.classList.toggle('on', !!zones.a);
    if (ui.zoneFull) {
      ui.zoneFull.hidden = !cfg.b;
      if (cfg.b) {
        ui.zoneFull.textContent = cfg.b.label;
        ui.zoneFull.classList.toggle('on', !!zones.b);
      } else {
        ui.zoneFull.textContent = '';
        ui.zoneFull.classList.remove('on');
      }
    }
    if (ui.zoneKill) {
      ui.zoneKill.hidden = !cfg.c;
      if (cfg.c) {
        ui.zoneKill.textContent = cfg.c.label;
        ui.zoneKill.classList.toggle('on', !!zones.c);
      } else {
        ui.zoneKill.textContent = '';
        ui.zoneKill.classList.remove('on');
      }
    }
  }

  function selectSkill(id) {
    if (!skills[id]) return;
    state.skill = id;
    if (id !== 'vehicle') state.vehicleLoading = false;
    for (const button of ui.skills.querySelectorAll('button')) {
      button.classList.toggle('on', button.dataset.fs === id);
    }
    ui.vehicleRow.hidden = id !== 'vehicle';
    if (ui.azimuthRow) ui.azimuthRow.hidden = !(id === 'guided' || id === 'thermobaric' || id === 'artillery');
    syncZoneButtons();
    state.staticView = true;
    state.playing = false;
    cancelAnimationFrame(raf);
    if (state.center) build();
    renderParams();
    updateSkillHint();
    if (id === 'vehicle') refreshVehicles();
  }

  function updateSkillHint() {
    const skill = skills[state.skill];
    if (!skill) return;
    if (state.vehicleLoading) { setHint('正在载入载具模型…'); return; }
    if (state.placing) setHint('在地图上点击放置落点；也可以再点一次「选择落点」取消。');
    else if (!state.center) setHint(`已选「${skill.name}」。点「选择落点」，再点地图放置预览。`);
    else if (state.playing) setHint('预览中：拖动时间轴可定格任意时刻。');
    else if (['guided', 'thermobaric', 'artillery', 'smoke'].includes(state.skill)
      && !currentZones().a && !currentZones().b && !currentZones().c) {
      setHint(`「${skill.name}」已放置；当前所有范围已隐藏，可用下方「显示」按钮打开。`);
    } else {
      const hasZones = ['guided', 'thermobaric', 'artillery', 'smoke'].includes(state.skill);
      const extra = [
        hasZones ? '、用「显示」按钮切换范围' : '',
        state.skill === 'guided' || state.skill === 'thermobaric' || state.skill === 'artillery'
          ? '、拖动「来袭方位」调整轨迹' : '',
      ].filter(Boolean).join('');
      setHint(`「${skill.name}」已放置。可播放预览、拖动时间轴${extra}或改选其他技能。`);
    }
  }

  function placeAt(point) {
    if (!point) return false;
    const y = Number.isFinite(point.y) ? point.y + 0.25 : (heightAt(point.x, point.z) + 0.25);
    state.center = new THREE.Vector3(point.x, y, point.z);
    state.placing = false;
    state.staticView = true;
    state.playing = false;
    cancelAnimationFrame(raf);
    if (ui.place) ui.place.classList.remove('on');
    build();
    renderParams();
    updateSkillHint();
    return true;
  }

  function clear() {
    state.center = null;
    state.placing = false;
    state.playing = false;
    state.vehicleLoading = false;
    cancelAnimationFrame(raf);
    clearGroup();
    if (ui.place) ui.place.classList.remove('on');
    if (ui.time) { ui.time.value = '0'; }
    if (ui.timeV) ui.timeV.textContent = '—';
    updateSkillHint();
  }

  function togglePlace() {
    state.placing = !state.placing;
    if (ui.place) ui.place.classList.toggle('on', state.placing);
    if (state.placing) {
      state.playing = false;
      cancelAnimationFrame(raf);
    }
    updateSkillHint();
  }

  function beginPlacement() {
    state.placing = true;
    state.playing = false;
    state.staticView = true;
    cancelAnimationFrame(raf);
    if (ui.place) ui.place.classList.add('on');
    updateSkillHint();
    return true;
  }

  function cancelPlacement() {
    state.placing = false;
    if (ui.place) ui.place.classList.remove('on');
    updateSkillHint();
  }

  function preview() {
    const skill = skills[state.skill];
    const center = state.center;
    return {
      center: center ? { x: center.x, y: center.y, z: center.z } : null,
      skill: state.skill,
      skillName: skill?.name || state.skill,
      blastRadius: Number(skill?.blast?.radius) || 0,
      fullRadius: Number(skill?.blast?.fullRadius) || 0,
    };
  }

  // 事件
  ui.skills.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-fs]');
    if (button) selectSkill(button.dataset.fs);
  });
  ui.vehicle.addEventListener('change', () => {
    state.vehicleId = Number(ui.vehicle.value) || null;
    if (state.center) build();
    renderParams();
    updateSkillHint();
  });
  ui.place.addEventListener('click', togglePlace);
  ui.play.addEventListener('click', play);
  ui.stop.addEventListener('click', stop);
  ui.clear.addEventListener('click', clear);
  ui.time.addEventListener('input', () => {
    state.playing = false;
    cancelAnimationFrame(raf);
    state.staticView = false;
    state.t = Number(ui.time.value) || 0;
    ui.timeV.textContent = `${state.t.toFixed(1)} s`;
    applyTime(state.t);
    setHint(`已定格在 ${state.t.toFixed(1)} s；点「播放预览」从头播放。`);
  });
  if (ui.azimuth) {
    ui.azimuth.value = String(state.azimuth);
    if (ui.azimuthV) ui.azimuthV.textContent = `${state.azimuth}°`;
    ui.azimuth.addEventListener('input', () => {
      state.azimuth = Number(ui.azimuth.value) || 0;
      if (ui.azimuthV) ui.azimuthV.textContent = `${state.azimuth}°`;
      if (!state.center) return;
      state.playing = false;
      cancelAnimationFrame(raf);
      state.staticView = true;
      build();
    });
  }
  function toggleZone(key) {
    const cfg = zoneConfigFor(skills[state.skill]);
    if (!cfg || !cfg[key]) return;
    if (!zoneState[state.skill]) {
      zoneState[state.skill] = { ...(zoneDefaults[state.skill] || { a: false, b: false, c: false }) };
    }
    zoneState[state.skill][key] = !zoneState[state.skill][key];
    syncZoneButtons();
    if (state.center) {
      state.playing = false;
      cancelAnimationFrame(raf);
      state.staticView = true;
      build();
    }
    updateSkillHint();
  }
  if (ui.zoneRange) ui.zoneRange.addEventListener('click', () => toggleZone('a'));
  if (ui.zoneFull) ui.zoneFull.addEventListener('click', () => toggleZone('b'));
  if (ui.zoneKill) ui.zoneKill.addEventListener('click', () => toggleZone('c'));

  refreshVehicles();
  selectSkill('guided');
  updateSkillHint();

  return {
    isPlacing: () => state.placing,
    beginPlacement,
    cancelPlacement,
    preview,
    placeAt,
    clear,
    refresh: () => { refreshVehicles(); renderParams(); },
    selectSkill,
    state,
  };
}
