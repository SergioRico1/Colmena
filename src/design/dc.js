// Minimal re-implementation of the design tool's DCLogic contract so the
// generated design components (src/design/*.jsx) behave exactly like the
// mockups: constructor(props) + this.state + setState + renderVals().
import { useEffect, useReducer, useRef } from "react";

export class DCLogic {
  constructor(props) {
    this.props = props || {};
    this.state = {};
    this.__host = null;
  }
  setState(patch, callback) {
    this.__host?.setState(patch, callback);
  }
  forceUpdate() {
    this.__host?.force();
  }
  componentDidMount() {}
  componentDidUpdate() {}
  componentWillUnmount() {}
  renderVals() {
    return {};
  }
}

export function withDefaults(meta, props) {
  const out = {};
  for (const key in meta || {}) {
    if (key.startsWith("$")) continue;
    if (meta[key]?.default !== undefined) out[key] = meta[key].default;
  }
  return { ...out, ...props };
}

export function useDCLogic(Logic, props) {
  const [, force] = useReducer((x) => x + 1, 0);
  const ref = useRef(null);
  if (!ref.current) {
    const instance = new Logic(props);
    instance.__host = {
      force,
      setState(patch, callback) {
        const next = typeof patch === "function" ? patch(instance.state, instance.props) : patch;
        if (next) instance.state = { ...instance.state, ...next };
        force();
        if (callback) queueMicrotask(callback);
      },
    };
    ref.current = instance;
  }
  const instance = ref.current;
  const previous = useRef(null);
  instance.props = props;
  useEffect(() => {
    instance.componentDidMount?.();
    return () => instance.componentWillUnmount?.();
  }, []);
  useEffect(() => {
    if (previous.current) instance.componentDidUpdate?.(previous.current.props, previous.current.state);
    previous.current = { props, state: instance.state };
  });
  return instance.renderVals();
}
