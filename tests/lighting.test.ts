import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS, isBuiltin, presetNameError } from '../src/viewer/lighting.ts';

describe('lighting presets', () => {
  it('validates new preset names', () => {
    const existing = [...BUILTIN_PRESETS, 'Rainy alley'];
    expect(presetNameError('Club interior', existing)).toBeNull();
    expect(presetNameError('   ', existing)).toMatch(/name/);
    expect(presetNameError('night', existing)).toMatch(/exists/);
    expect(presetNameError('rainy ALLEY ', existing)).toMatch(/exists/);
    expect(presetNameError('x'.repeat(41), existing)).toMatch(/40/);
  });
  it('knows the built-ins', () => {
    expect(isBuiltin('night')).toBe(true);
    expect(isBuiltin('Rainy alley')).toBe(false);
  });
});
