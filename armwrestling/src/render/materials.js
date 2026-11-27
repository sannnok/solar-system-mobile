/**
 * Shaders for the X-ray look: ivory bones, a fresnel skin shell, and muscles
 * whose colour runs from cold steel to hot red with activation, with pulses
 * travelling along the fibres when they work hard.
 *
 * Every material here lights itself from a fixed view-space direction, so the
 * scene needs no lights for the anatomy and looks the same from every angle.
 */

import * as THREE from 'three';

const VERTEX = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

/** Additive fresnel shell — skin, and the red "error" ghost. */
export function createRimMaterial({ color, base = 0.02, strength = 0.5, power = 2.0 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uBase: { value: base },
      uStrength: { value: strength },
      uPower: { value: power },
    },
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uBase;
      uniform float uStrength;
      uniform float uPower;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(-vV))), uPower);
        float a = uBase + f * uStrength;
        gl_FragColor = vec4(uColor * a, a);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Opaque bone with a soft rim; `uGlow` tints it red for the danger overlay. */
export function createBoneMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xd8d0bf) },
      uGlow: { value: 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uGlow;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec3 n = normalize(vN);
        float diff = 0.28 + 0.72 * max(dot(n, normalize(vec3(0.35, 0.8, 0.5))), 0.0);
        float rim = pow(1.0 - abs(dot(n, normalize(-vV))), 2.4);
        vec3 col = uColor * diff + vec3(0.55, 0.75, 1.0) * rim * 0.35;
        col = mix(col, vec3(1.0, 0.2, 0.25), uGlow);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * One material per muscle so activation and selection are per-muscle uniforms;
 * three.js still compiles the shader once and shares the program.
 * `aBelly` is 0 along tendons and 1 at the thickest part of the belly.
 */
export function createMuscleMaterial(timeUniform) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeUniform,
      uAct: { value: 0 },
      uSel: { value: 0 },
      uDim: { value: 1 },
      uCold: { value: new THREE.Color(0x1f4466) },
      uWarm: { value: new THREE.Color(0xf29a2e) },
      uHot: { value: new THREE.Color(0xff3347) },
      uTendon: { value: new THREE.Color(0xc4ccd6) },
    },
    vertexShader: /* glsl */ `
      attribute float aBelly;
      varying vec3 vN;
      varying vec3 vV;
      varying vec2 vUv;
      varying float vBelly;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = mv.xyz;
        vN = normalize(normalMatrix * normal);
        vUv = uv;
        vBelly = aBelly;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uAct;
      uniform float uSel;
      uniform float uDim;
      uniform vec3 uCold;
      uniform vec3 uWarm;
      uniform vec3 uHot;
      uniform vec3 uTendon;
      varying vec3 vN;
      varying vec3 vV;
      varying vec2 vUv;
      varying float vBelly;

      void main() {
        vec3 n = normalize(vN);
        float ndv = abs(dot(n, normalize(-vV)));
        float rim = pow(1.0 - ndv, 2.5);
        float diff = 0.32 + 0.68 * max(dot(n, normalize(vec3(0.35, 0.8, 0.5))), 0.0);

        float a = clamp(uAct, 0.0, 1.0);
        // Stabilisers stay cool; only real work turns warm, and only near-max turns red.
        vec3 heat = mix(uCold, uWarm, smoothstep(0.22, 0.68, a));
        heat = mix(heat, uHot, smoothstep(0.66, 1.0, a));

        // Fibres run along the muscle, so stripe across the circumference.
        float fibres = 0.84 + 0.16 * sin(vUv.x * 6.2831853 * 8.0);
        float tendon = 1.0 - smoothstep(0.08, 0.4, vBelly);
        vec3 col = mix(heat * fibres, uTendon * 0.8, tendon) * diff;

        // Contraction pulses travelling from origin to insertion.
        float wave = pow(max(sin(vUv.y * 16.0 - uTime * 6.0), 0.0), 6.0);
        col += uHot * wave * a * a * (1.0 - tendon) * 0.85;

        col += heat * rim * (0.3 + 1.5 * a);
        col += vec3(1.0) * uSel * rim * (0.7 + 0.3 * sin(uTime * 5.0));
        gl_FragColor = vec4(col * uDim, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}
