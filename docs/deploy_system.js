/* 部署系统：把步兵部署（据点/基地复活点）与载具固定部署点合并为一个叠加层。
 * 由 map.html 传入上下文，避免模块直接依赖页面全局变量。 */

export function buildDeployment(ctx) {
  const {
    THREE, scene, labelsEl, areasData, spawnData, deployData, vehicleData,
    simpleLabel, objectiveStage, spawnStageVisible, campVisible, dashedLink,
    vehicleMarkerColor, vehicleSerialOf, vehicleSerialFromName, vehicleSelectedSector,
    vehicleSpawnVisible, vehicleIconVisible, vehicleHighlightId,
    vehicleSpawnerVisible, vehicleSpriteCache, deployLinksVisible, mapCode,
    addVol3dPrism, volumeRangeFor, activePhaseSrc, regularPhaseSrc, regularOnly, objectivePhaseKeys, captureAnchorLabel,
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
  const areaOf = (target) => {
    const keys = (target && typeof target === 'object'
      ? [target.label, target.icon, target.name, target.displayLabel]
      : [target]).filter(Boolean).map(String);
    const norm = (s) => String(s || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    return areasData.find((a) => a.kind === 'objective'
      && keys.includes(String(a.srcLabel || simpleLabel(a.label)))) ||
      areasData.find((a) => a.kind === 'objective'
        && keys.some((k) => norm(k) === norm(a.srcLabel || simpleLabel(a.label))));
  };
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
    // 阶段计划激活时只画该阶段的点；「全部阶段」只画常规阶段的点，
    // 避免常规 D 与事件 D2、余震 B1/B2 分支等互斥阶段的旗杆区叠在一起。
    // 优先用 capture.json 的 anchor label 作身份；spawns 的 label/icon 会被阶段计划改写（D2→D1），不能直接信。
    const anchorLabel = captureAnchorLabel ? captureAnchorLabel(ob.name) : null;
    const phaseKeys = anchorLabel ? [anchorLabel]
      : (objectivePhaseKeys ? objectivePhaseKeys(ob) : [String(ob.icon || ob.label)]);
    if (activePhaseSrc && !phaseKeys.some((k) => activePhaseSrc.has(k))) continue;
    if (!activePhaseSrc && regularOnly && regularPhaseSrc && !phaseKeys.some((k) => regularPhaseSrc.has(k))) continue;
    const stage = objectiveStage(ob.label);
    if (!spawnStageVisible(ob.label, stage)) continue;
    const flag = ob.flagPos || ob.pos;
    const flagV = new THREE.Vector3(flag[0], flag[1], flag[2]);
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
    const area = areaOf(ob);
    if (area && (area.points || []).length >= 3) {
      // 最大占点倍率区：旗杆中心（flagPos）缩放 10%，用「据点体积」同款棱柱显示；
      // 高度与该据点体积一致：volumes3d.zRange[0] 为底、heightM 为高（缺数据用 DetectHeight）。
      const RATIO = 0.1;
      const source = area.points;
      const step = Math.max(1, Math.ceil(source.length / 48));
      const sampled = [];
      for (let i = 0; i < source.length; i += step) sampled.push(source[i]);
      if (sampled[sampled.length - 1] !== source[source.length - 1]) sampled.push(source[source.length - 1]);
      const ringPts = sampled.map((p) => new THREE.Vector3(
        flag[0] + (p[0] - flag[0]) * RATIO,
        0,
        flag[2] + (p[2] - flag[2]) * RATIO,
      ));
      const range = volumeRangeFor ? volumeRangeFor(ob) : null;
      const bottomY = range ? range.bottomY : flag[1];
      const topY = range ? range.topY : flag[1] + Math.max((Number(ob.detectHeight) || 0) / 100, 0.25);
      if (addVol3dPrism && ringPts.length >= 3) {
        const prism = addVol3dPrism(
          ringPts.map((p) => [p.x, 0, p.z]), bottomY, topY, BONUS,
        );
        if (prism) spawnGroup.add(prism);
      }
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
