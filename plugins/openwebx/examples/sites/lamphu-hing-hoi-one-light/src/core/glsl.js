// GLSL snippets to concatenate into ShaderMaterial sources:
//   fragmentShader: `${GLSL.simplex3}\n${GLSL.fbm}\n void main(){ ... }`

export const GLSL = {
  // Ashima/Stefan Gustavson simplex noise (MIT). snoise(vec3) -> -1..1
  simplex3: /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`,

  // Requires simplex3. 4-octave fractal noise.
  fbm: /* glsl */ `
float fbm(vec3 p){
  float a=0.5, s=0.0;
  for(int i=0;i<4;i++){ s+=a*snoise(p); p=p*2.02+vec3(17.1,3.7,9.2); a*=0.5; }
  return s;
}`,

  hash: /* glsl */ `
float hash11(float p){p=fract(p*0.1031);p*=p+33.33;p*=p+p;return fract(p);}
float hash21(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}`,

  // Fresnel rim term for atmospheres / glass edges.
  fresnel: /* glsl */ `
float fresnel(vec3 viewDir, vec3 normal, float power){
  return pow(1.0-clamp(dot(normalize(viewDir),normalize(normal)),0.0,1.0),power);
}`,

  // Soft round point sprite alpha for gl_PointCoord.
  softPoint: /* glsl */ `
float softPoint(vec2 uv){ float d=length(uv-0.5); return smoothstep(0.5,0.0,d); }`,

  // Cheap film grain to break gradient banding. grain(uv, time) -> -0.5..0.5
  grain: /* glsl */ `
float grain(vec2 uv, float t){ return fract(sin(dot(uv*1000.0+t, vec2(12.9898,78.233)))*43758.5453)-0.5; }`,
};
