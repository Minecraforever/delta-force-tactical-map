/* 部署系统：把步兵部署（据点/基地复活点）与载具固定部署点合并为一个叠加层。
 * 由 map.html 传入上下文，避免模块直接依赖页面全局变量。 */

export function buildDeployment(ctx) {
  const {
    THREE, scene, labelsEl, areasData, spawnData, deployData, vehicleData,
    simpleLabel, objectiveStage, spawnStageVisible, campVisible, dashedLink,
    vehicleMarkerColor, vehicleSerialOf, vehicleSerialFromName, vehicleSelectedSector,
    vehicleSpawnVisible, vehicleIconVisible, vehicleHighlightId,
    vehicleSpawnerVisible, vehicleSpriteCache, deployLinksVisible, mapCode,
  } = ctx;

  const ATK = 0x2ecc71, DEF = 0xe74c3c, REBORN = 0x8fa3bf, BONUS = 0xf1c40f, VEH_LINK = 0xf0c75e;
  const labels = [];
  const spawnGroup = new THREE.Group();
  spawnGroup.name = 'spawns';
  const linkGroup = new THREE.Group();
  linkGroup.name = 'deployLinks';
  linkGroup.visible = deployLinksVisible;
  spawnGroup.add(linkGroup);

  const mk = (c, opacity = 0.95) => new THREE.MeshBasicMaterial({
    color: c, depthTest: false, transparent: true, opacity,
  });
  const areaOf = (label) => areasData.find((a) => a.kind === 'objective' &&
    (a.srcLabel || simpleLabel(a.label)) === label);
  const putMarker = (p, col, size, lift, option, linkColor) => {
    const gy = p[1];
    const y = gy + lift;
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 6), mk(col));
    m.position.set(p[0], y, p[2]);
    spawnGroup.add(m);
    const stem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(p[0], gy, p[2]), new THREE.Vector3(p[0], y, p[2])]),
      new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.3 }));
    spawnGroup.add(stem);
    if (option) {
      const oy = option.y + 1;
      linkGroup.add(dashedLink(
        new THREE.Vector3(option.x, oy, option.z),
        new THREE.Vector3(p[0], y, p[2]), linkColor));
    }
  };

  // ---- 步兵部署：据点内外复活点 ----
  for (const ob of spawnData?.objectives || []) {
    const stage = objectiveStage(ob.label);
    if (!spawnStageVisible(ob.label, stage)) continue;
    const flagV = new THREE.Vector3(ob.pos[0], ob.pos[1], ob.pos[2]);
    const groups = [
      ['Camp0InnerSpawnAreas', ATK, 3.4, 6, 'attack'],
      ['Camp0OuterSpawnAreas', ATK, 2.0, 6, 'attack'],
      ['Camp1InnerSpawnAreas', DEF, 3.4, 6, 'defend'],
      ['Camp1OuterSpawnAreas', DEF, 2.0, 6, 'defend'],
    ];
    for (const [key, col, size, lift, camp] of groups) {
      if (!campVisible(camp)) continue;
      for (const p of ob.spawns?.[key] || []) putMarker(p, col, size, lift, flagV, col);
    }
    const area = areaOf(ob.label);
    if (area && (area.points || []).length >= 3) {
      // 最大占点倍率区：将据点边界按旗杆中心缩放 10%，保留边界采样点的真实高度。
      const RATIO = 0.1;
      const source = area.points;
      const step = Math.max(1, Math.ceil(source.length / 48));
      const sampled = [];
      for (let i = 0; i < source.length; i += step) sampled.push(source[i]);
      if (sampled[sampled.length - 1] !== source[source.length - 1]) sampled.push(source[source.length - 1]);
      const ringPts = sampled.map((p) => {
        const py = Number.isFinite(Number(p[1])) ? Number(p[1]) : ob.pos[1];
        return new THREE.Vector3(
          ob.pos[0] + (p[0] - ob.pos[0]) * RATIO,
          ob.pos[1] + (py - ob.pos[1]) * RATIO + 1.2,
          ob.pos[2] + (p[2] - ob.pos[2]) * RATIO,
        );
      });
      // 半透明填充：小区域在远景下也能看见范围
      const shape = new THREE.Shape();
      ringPts.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
      const fillGeo = new THREE.ShapeGeometry(shape);
      fillGeo.rotateX(-Math.PI / 2);
      const yByKey = new Map(ringPts.map((p) =>
        [`${Math.round(p.x * 100)},${Math.round(p.z * 100)}`, p.y]));
      const fillPos = fillGeo.attributes.position;
      for (let k = 0; k < fillPos.count; k++) {
        const y = yByKey.get(`${Math.round(fillPos.getX(k) * 100)},${Math.round(fillPos.getZ(k) * 100)}`);
        fillPos.setY(k, (y ?? ob.pos[1] + 1.2) + 0.15);
      }
      fillPos.needsUpdate = true;
      const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({
        color: BONUS, depthTest: false, transparent: true, opacity: 0.18,
        side: THREE.DoubleSide, depthWrite: false,
      }));
      fill.renderOrder = 21;
      spawnGroup.add(fill);
      // 粗边界：LineBasicMaterial 的 linewidth 在多数浏览器无效，用 Tube 代替
      const curve = new THREE.CatmullRomCurve3(ringPts, true);
      const tube = new THREE.TubeGeometry(curve, Math.max(32, ringPts.length * 2), 0.75, 6, true);
      const outline = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({
        color: BONUS, depthTest: false, transparent: true, opacity: 0.98,
      }));
      outline.renderOrder = 23;
      spawnGroup.add(outline);
    }
    if ((ob.reborn || []).length >= 3) {
      const pts = ob.reborn.concat([ob.reborn[0]])
        .map((p) => new THREE.Vector3(p[0], p[1] + 0.5, p[2]));
      spawnGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: REBORN, depthTest: false, transparent: true, opacity: 0.75 })));
    }
  }

  // ---- 步兵部署：基地/增援 hub + 该 hub 的载具呼叫点 ----
  const vehicleMaps = vehicleData?.maps || {};
  const vehicleKey = Object.keys(vehicleMaps).find((key) => key.toLowerCase() === String(mapCode).toLowerCase());
  const vehicleMap = (vehicleKey && vehicleMaps[vehicleKey]) || null;
  const spawnerByName = new Map();
  for (const s of vehicleMap?.spawners || []) {
    spawnerByName.set(s.name, s);
    spawnerByName.set(s.id, s);
  }
  const hubNodes = [];
  for (const h of deployData?.hubs || []) {
    if (!spawnStageVisible(null, h.stage)) continue;
    if (!campVisible(h.camp)) continue;
    const col = h.camp === 'attack' ? ATK : DEF;
    const hubV = h.pos ? new THREE.Vector3(h.pos[0], h.pos[1], h.pos[2]) : null;
    for (const p of h.spawnAreas || []) putMarker(p, col, 2.6, 8, hubV, col);
    if (hubV) {
      const spawnYs = (h.spawnAreas || [])
        .map((p) => (Array.isArray(p) ? p[1] : NaN))
        .filter((y) => Number.isFinite(y));
      const baseY = spawnYs.length ? Math.max(hubV.y, ...spawnYs) : hubV.y;
      const nodeY = baseY + 15;
      const node = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), mk(col, 0.9));
      node.position.set(hubV.x, nodeY, hubV.z);
      node.renderOrder = 30;
      spawnGroup.add(node);
      spawnGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(hubV.x, baseY, hubV.z), new THREE.Vector3(hubV.x, nodeY, hubV.z)]),
        new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.4 })));
      hubNodes.push({ hub: h, node: new THREE.Vector3(hubV.x, nodeY, hubV.z) });
      const div = document.createElement('div');
      div.className = 'plabel';
      div.textContent = (h.displayName || h.name) + (h.disableFootSoldier ? '（载具）' : '');
      div.style.color = '#' + col.toString(16).padStart(6, '0');
      labelsEl.appendChild(div);
      labels.push({ div, pos: new THREE.Vector3(hubV.x, nodeY + 15, hubV.z) });
    }
  }

  // ---- 载具固定部署点 ----
  const vehicleGroup = new THREE.Group();
  vehicleGroup.name = 'vehicleSystem';
  if (vehicleMap) {
    for (const spawner of vehicleMap.spawners) {
      if (vehicleSpawnerVisible && !vehicleSpawnerVisible(spawner)) continue;
      if (!spawner.location || spawner.location.x == null) continue;
      const highlighted = !!vehicleHighlightId && spawner.vehicleId === vehicleHighlightId;
      const pos = new THREE.Vector3(spawner.location.x, spawner.location.y + 0.6, spawner.location.z);
      if (vehicleSpawnVisible || highlighted) {
        vehicleGroup.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(pos.x, pos.y - 0.6, pos.z), pos]),
          new THREE.LineBasicMaterial({ color: vehicleMarkerColor(spawner), depthTest: false })));
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(spawner.kind === 'camp' ? 2.4 : 1.8, 12, 8),
          new THREE.MeshBasicMaterial({ color: highlighted ? 0xff5470 : vehicleMarkerColor(spawner), depthTest: false }));
        marker.position.copy(pos);
        marker.renderOrder = 18;
        vehicleGroup.add(marker);
        if (highlighted) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(3.0, 3.8, 24),
            new THREE.MeshBasicMaterial({
              color: 0xff5470, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9,
            }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(pos.x, pos.y + 0.2, pos.z);
          ring.renderOrder = 19;
          vehicleGroup.add(ring);
        }
      }
      if (vehicleIconVisible && spawner.vehicleId) {
        const texture = vehicleSpriteCache.get(spawner.vehicleId);
        if (texture) {
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: texture, depthTest: false, transparent: true, color: vehicleMarkerColor(spawner),
          }));
          sprite.position.set(pos.x, pos.y + 8, pos.z);
          sprite.scale.set(12, 12, 1);
          sprite.renderOrder = 19;
          vehicleGroup.add(sprite);
        }
      }
    }
  }

  // ---- 载具呼叫点连到对应部署 hub ----
  for (const { hub, node } of hubNodes) {
    for (const name of hub.vehicleSpawners || []) {
      const spawner = spawnerByName.get(name);
      if (!spawner?.location || spawner.location.x == null) continue;
      if (vehicleSpawnerVisible && !vehicleSpawnerVisible(spawner)) continue;
      linkGroup.add(dashedLink(
        node,
        new THREE.Vector3(spawner.location.x, spawner.location.y + 1, spawner.location.z),
        VEH_LINK));
    }
  }

  return { spawnGroup, vehicleGroup, labels };
}
