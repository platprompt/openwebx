// Media access that works in every host. Always go through these helpers:
//   media(path)       -> URL for <img>/TextureLoader (blob URL when embedded)
//   mediaBytes(path)  -> ArrayBuffer (decoded in place when embedded, so no
//                        fetch: Claude Artifacts and Canvas hosts block it)
// The single-file presentation bundle (bundle.py) fills window.__OX_MEDIA__
// with base64 payloads keyed by their site path; glTF is packed as GLB.

const urls = new Map();

function decode(path) {
  const { b64 } = window.__OX_MEDIA__[path];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const isEmbedded = (path) => !!(window.__OX_MEDIA__ && window.__OX_MEDIA__[path]);

export function media(path) {
  if (!isEmbedded(path)) return path;
  if (!urls.has(path)) {
    urls.set(path, URL.createObjectURL(new Blob([decode(path)], { type: window.__OX_MEDIA__[path].type })));
  }
  return urls.get(path);
}

export async function mediaBytes(path) {
  if (isEmbedded(path)) return decode(path).buffer;
  const res = await fetch(path);
  if (!res.ok) throw new Error(`media ${path}: HTTP ${res.status}`);
  return res.arrayBuffer();
}
