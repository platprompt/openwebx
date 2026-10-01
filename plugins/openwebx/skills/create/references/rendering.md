# Rendering fidelity

A scene looks "real" when four layers are all present. Geometry detail is
the least important of them. Flat, unlit silhouettes read as illustration
however good the composition is.

## Realism in a controlled set
Real-time realism holds up when the world is **small and bounded**: a room, a
tabletop, a diorama, one object on a seamless backdrop. Open landscapes with
forests and terrain turn muddy and cheap-looking in a browser. So:
- Build a **set**, not a world: a lit table with a model of the mountain the
  lantern climbs; a room whose window moves through the hours; a studio sweep
  behind a product. The theme lives in the materials, light and objects.
- When a landscape is essential, let sky, fog and distance carry most of the
  frame, keep the foreground to one well-made patch, and frame it like a
  photograph of a model.
- Every chapter has a **key light with a clear direction** and real contrast:
  a bright side, a shadow side, and something near white and near black in
  the frame. Murk is a failure (`G-light`).
- The **hero** (`brief.scene.hero`) is either a CC0 model or a procedural
  build with at least three concrete detail features (bevels, wear, a
  secondary material, fine normal detail). Flat extrusions of 2D icons,
  untextured primitives and blocky stand-ins never play the hero.


| Layer | Real looks like | Kit tool |
|---|---|---|
| **Light from an environment** | Every surface picks up sky and bounce light; reflections exist | `useHDRI` (CC0 HDRI) · `useSky` (physical sky that re-bakes its own environment) · `useStudio` (objects) |
| **Physically based surfaces** | Roughness varies, normals carry micro-detail, and colour isn't flat | `loadPBR` (CC0 texture sets) · `createTerrain` slope shader · `MeshPhysicalMaterial` (glass, clearcoat, sheen, transmission) |
| **Atmosphere and depth** | Distant things fade into air colour; mist has layers; light has direction | `atmosphere` (FogExp2 matched to the sky) · `createMist` · a low sun · `softShadows` |
| **Camera finish** | Highlights bloom slightly, the frame has grain and vignette, the focus falls off | `createPost({ bloom, grain, vignette, dof, grade, chroma })` |

## `brief.look`
```json
"look": {
  "fidelity": "cinematic-real",
  "lighting": "hdri",
  "cc0": [
    { "type": "hdri", "id": "table_mountain_1", "res": "1k", "role": "sky and ambient light at dawn" },
    { "type": "texture", "id": "forest_ground_04", "res": "1k", "role": "trail surface" },
    { "type": "model", "id": "pine_tree_01", "res": "1k", "role": "montane forest (instanced)" }
  ],
  "post": { "bloom": { "strength": 0.3, "threshold": 0.85 }, "grain": 0.045, "vignette": 0.3, "dof": { "focus": 14 }, "grade": { "warmth": 0.25 } },
  "camera": { "fov": 35 }
}
```
- `fidelity` is one of the following. It defaults to `cinematic-real`, and a
  stylised level is used only when the theme asks for it (Y2K, Bauhaus,
  paper-cut, pixel):
  - `cinematic-real`: photographic light, PBR, atmosphere and a camera
    finish.
  - `painterly`: real light with stylised surfaces (toon ramps, brush-noise
    grading).
  - `graphic`: flat, deliberate design. Choose it on purpose, never by
    accident.
- `lighting`: `hdri` (best realism outdoors or indoors), `sky` (for a moving
  sun: dawn to day, day to night), or `studio` (objects and products). You
  can combine them, e.g. an HDRI for ambient light plus a `DirectionalLight`
  for the key light and shadows.
- `cc0`: the Poly Haven assets the director picked (see below). The builder
  fetches them with `fetch_cc0.py get <site> --from-brief`.
- `camera.fov`: 28–40 feels photographic, and ≥ 55 feels like a game. Use
  lens-like values.

## CC0 assets (Poly Haven)
All assets are CC0, so no attribution is needed in the site. Search is
powered by Poly Haven.
```bash
python "<skill>/scripts/fetch_cc0.py" search hdris "sunrise mountain"
python "<skill>/scripts/fetch_cc0.py" search textures "forest ground"
python "<skill>/scripts/fetch_cc0.py" search models "pine tree"
python "<skill>/scripts/fetch_cc0.py" get "<site>" --from-brief
```
Budget:
- 1k resolution by default;
- 1 HDRI + ≤ 3 texture sets + ≤ 3 models;
- ≤ 12 MB of media in total, so the presentation bundle stays under 15 MB.

Content images from the user always outrank stock assets.

Always load media through `media('media/...')` (from `core/assets.js`, and
already used inside `useHDRI`, `loadPBR`, `loadModel` and `loadTexture`), so
the single-file presentation can embed it.

## Recipes
- **Outdoor landscape at dawn (only when a set will not do):**
  - HDRI (a sunrise-sunset category) for the background and IBL;
  - `createTerrain` with the slope shader or a PBR ground;
  - `createMist` between the ridges;
  - `atmosphere` fog matched to the horizon colour;
  - a warm `DirectionalLight` at the sun's azimuth with `softShadows`;
  - post: bloom 0.3, grain 0.045, vignette 0.3, warmth 0.2.
- **Product / specimen:**
  - `useStudio` or a studio HDRI (`search hdris "studio"`);
  - `MeshPhysicalMaterial` (transmission / clearcoat / sheen / iridescence);
  - a soft contact shadow (a plane with a radial-gradient `ShadowMaterial`,
    or a blurred shadow texture);
  - post: dof on the object, grain 0.03, vignette 0.2.
- **Interior / architecture:** an indoor HDRI for ambient light, one hard
  key light with shadows, PBR plaster, concrete or wood from the texture
  search, and light haze using `atmosphere` with a low density.
- **Space:** a black background. Realism comes from shader detail (fbm
  surfaces, fresnel atmospheres, emissive night sides) plus bloom and a
  point-sprite starfield. HDRIs aren't needed.
- **Water:** use `three/addons/objects/Water.js` with a normal map from the
  texture search, or a mirror plane with a roughness-blurred reflection.

## Performance with realism
- Environment maps are cheap. Shadows are not: use one shadow-casting light
  and turn shadows off on `low`.
- Instance repeated models (`InstancedMesh`). Never clone 200 trees.
- Use 1k textures and `anisotropy` 8 (2 on low).
- DOF runs on the high tier only (the kit enforces this). Bloom is off on
  low.
- Re-bake `useSky` only when the sun moves more than 1.5° (the kit
  throttles this).
