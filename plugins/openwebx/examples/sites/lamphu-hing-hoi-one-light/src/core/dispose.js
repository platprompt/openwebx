// Release GPU memory held by an Object3D subtree. Call from Scene.dispose()
// and whenever a chapter swaps out geometry it will not reuse.

const TEXTURE_KEYS = [
  'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap', 'envMap',
  'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap', 'specularMap',
  'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap',
  'sheenRoughnessMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap',
];

export function disposeMaterial(material) {
  if (!material) return;
  const list = Array.isArray(material) ? material : [material];
  for (const m of list) {
    for (const key of TEXTURE_KEYS) m[key]?.dispose?.();
    if (m.uniforms) {
      for (const u of Object.values(m.uniforms)) {
        const v = u && u.value;
        if (v && v.isTexture) v.dispose();
      }
    }
    m.dispose?.();
  }
}

export function disposeObject(root) {
  if (!root) return;
  root.traverse((obj) => {
    obj.geometry?.dispose?.();
    disposeMaterial(obj.material);
  });
  root.parent?.remove(root);
}
