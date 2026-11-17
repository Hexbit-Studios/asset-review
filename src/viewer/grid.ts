import * as THREE from 'three';

/**
 * Ground grid drawn in a shader instead of with GL lines (THREE.GridHelper):
 * - lines are anti-aliased from screen-space derivatives, so they never break into dashes
 *   at grazing angles or with distance;
 * - fine lines fade out before they get dense enough to moiré;
 * - the grid fades out radially instead of ending in a hard edge;
 * - it doesn't write depth, so it can't z-fight with the shadow plane or the model.
 */
export class GroundGrid extends THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  constructor() {
    super(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: {
          uMajor: { value: 1 },
          uMinorDivisions: { value: 4 },
          uFadeRadius: { value: 10 },
          uMinorAlpha: { value: 0.12 },
          uMajorAlpha: { value: 0.45 },
          uAxisAlpha: { value: 0.7 },
          uColor: { value: new THREE.Color(0x8a8aa3) },
          uAxisColor: { value: new THREE.Color(0xb6b6cc) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uMajor;
          uniform float uMinorDivisions;
          uniform float uFadeRadius;
          uniform float uMinorAlpha;
          uniform float uMajorAlpha;
          uniform float uAxisAlpha;
          uniform vec3 uColor;
          uniform vec3 uAxisColor;
          varying vec3 vWorld;

          // Coverage (0..1) of grid lines of the given spacing, ~1px wide on screen.
          float lines(vec2 p, float spacing, float widthPx) {
            vec2 c = p / spacing;
            vec2 d = fwidth(c);
            vec2 g = abs(fract(c - 0.5) - 0.5) / max(d, vec2(1e-5));
            return 1.0 - clamp(min(g.x, g.y) - (widthPx - 1.0) * 0.5, 0.0, 1.0);
          }

          // How visible lines of this spacing should be given how many pixels a cell covers.
          float density(vec2 p, float spacing) {
            vec2 d = fwidth(p / spacing);
            return 1.0 - smoothstep(0.12, 0.45, max(d.x, d.y));
          }

          void main() {
            vec2 p = vWorld.xz;
            float minorSpacing = uMajor / uMinorDivisions;
            float minor = lines(p, minorSpacing, 1.0) * density(p, minorSpacing) * uMinorAlpha;
            float major = lines(p, uMajor, 1.0) * density(p, uMajor) * uMajorAlpha;

            // The two axes through the origin, slightly brighter and a touch wider.
            vec2 w = fwidth(p);
            float axisX = 1.0 - clamp(abs(p.y) / max(w.y, 1e-5) - 0.5, 0.0, 1.0);
            float axisZ = 1.0 - clamp(abs(p.x) / max(w.x, 1e-5) - 0.5, 0.0, 1.0);
            float axis = max(axisX, axisZ) * uAxisAlpha;

            float fade = 1.0 - smoothstep(uFadeRadius * 0.55, uFadeRadius, length(p));
            float a = max(max(minor, major), axis) * fade;
            if (a < 0.003) discard;
            vec3 col = axis > max(minor, major) ? uAxisColor : uColor;
            gl_FragColor = vec4(col, a);
            #include <colorspace_fragment>
          }
        `,
      }),
    );
    this.renderOrder = -1; // under transparent content, after opaque
    this.frustumCulled = false;
  }

  /**
   * Size the grid for an object of the given bounding radius (metres). `pixelArt` (sprite
   * stacks at native resolution, where every line is a whole sprite pixel wide) drops the
   * sub-lines and dims the rest so the grid doesn't compete with the art.
   */
  fit(radius: number, pixelArt = false) {
    // Major lines: 1 m for normal props, 10 cm for small things, 5 m for buildings.
    const major = radius > 8 ? 5 : radius > 0.6 ? 1 : 0.1;
    const fade = Math.max(radius * 6, major * 6);
    this.material.uniforms.uMajor.value = major;
    this.material.uniforms.uMinorDivisions.value = major === 5 ? 5 : 4;
    this.material.uniforms.uFadeRadius.value = fade;
    this.material.uniforms.uMinorAlpha.value = pixelArt ? 0 : 0.12;
    this.material.uniforms.uMajorAlpha.value = pixelArt ? 0.22 : 0.45;
    this.material.uniforms.uAxisAlpha.value = pixelArt ? 0.35 : 0.7;
    this.scale.setScalar(fade * 2.2);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
