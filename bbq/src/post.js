// Camera pipeline: HDR render -> ambient occlusion -> volumetric fire + heat haze -> depth of
// field -> bloom, filmic tone mapping, grade, vignette and grain.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, Effect, BloomEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, NoiseEffect, DepthOfFieldEffect, BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

// Gentle split-tone + contrast, applied to the display-referred image.
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */`
      uniform vec3 uShadow; uniform vec3 uHigh; uniform float uContrast; uniform float uSat;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = max(inputColor.rgb, 0.0);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        c *= mix(uShadow, uHigh, smoothstep(0.0, 0.55, l));
        c = pow(c / 0.18, vec3(uContrast)) * 0.18;
        outputColor = vec4(c, inputColor.a);
      }`, {
      uniforms: new Map([
        ['uShadow', new THREE.Uniform(new THREE.Vector3(0.93, 0.99, 1.1))],
        ['uHigh', new THREE.Uniform(new THREE.Vector3(1.04, 1.0, 0.95))],
        ['uContrast', new THREE.Uniform(1.07)],
        ['uSat', new THREE.Uniform(1.05)],
      ]),
    });
  }
}

export function buildPost(renderer, scene, camera, tier, fireEffects = [], opts = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: tier.msaa });
  composer.addPass(new RenderPass(scene, camera));

  let ao = null;
  if (tier.ao) {
    ao = new N8AOPostPass(scene, camera, size.x, size.y);
    Object.assign(ao.configuration, {
      aoRadius: 0.32, distanceFalloff: 0.7, intensity: 2.4, aoSamples: tier.aoHalf ? 8 : 16,
      denoiseSamples: tier.aoHalf ? 4 : 8, denoiseRadius: 10, halfRes: tier.aoHalf, gammaCorrection: false,
    });
    composer.addPass(ao);
  }

  if (fireEffects.length) composer.addPass(new EffectPass(camera, ...fireEffects));

  let dof = null;
  if (tier.dof) {
    dof = new DepthOfFieldEffect(camera, { focusDistance: 1.8, focusRange: 3.2, bokehScale: 2.6, resolutionScale: 0.5 });
    composer.addPass(new EffectPass(camera, dof));
  }

  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.4, intensity: 0.85, radius: 0.76, levels: tier.low ? 6 : 8 });
  const tone = new ToneMappingEffect({ mode: opts.agx ? ToneMappingMode.AGX : ToneMappingMode.ACES_FILMIC });
  const grade = new GradeEffect();
  const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.58 });
  const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
  grain.blendMode.opacity.value = 0.11;
  composer.addPass(new EffectPass(camera, bloom, tone, grade, vignette, grain));

  return { composer, ao, dof, bloom, tone, grade, vignette, grain };
}
