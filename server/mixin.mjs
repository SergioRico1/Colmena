/**
 * Big classes split over several files: each file holds a group of methods in a container
 * class (never instantiated), and the owner installs them on its own prototype. The methods
 * arrive as they were written (same descriptors: async, generators, getters, not
 * enumerable), so `this`, instance overrides and prototype patches work as in one file.
 * A container cannot use `super` or private #fields of the owner.
 */
export function installMethods(target, ...containers) {
  for (const container of containers) {
    const { constructor: _skip, ...descriptors } = Object.getOwnPropertyDescriptors(container.prototype);
    Object.defineProperties(target.prototype, descriptors);
  }
}
