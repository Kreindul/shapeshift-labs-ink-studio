(function (K) {
  K.reflection = {
    plane: SceneOptics.plane,
    reflectedView: SceneOptics.reflectedView,
    material(base, plane, options) {
      return SurfaceLook.material(base, { layers: { mirror: { ...options, type: 'planarReflection', plane } } });
    }
  };
  K.ripple = { field: SceneOptics.ripple };
  K.atmosphere = {
    fog: SceneOptics.fog,
    sphere: SceneOptics.sphere,
    box: SceneOptics.box,
    shaft: SceneOptics.shaft,
    prepare: SceneOptics.prepareVolumes,
    trace: SceneOptics.trace
  };
})(KIT);
