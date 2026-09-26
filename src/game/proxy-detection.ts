type ProxyDetector = (value: unknown) => boolean;

export function loadProxyDetector(): ProxyDetector | null {
  const runtime = globalThis as typeof globalThis & {
    process?: { getBuiltinModule?: (specifier: string) => unknown };
  };
  const getBuiltinModule = runtime.process?.getBuiltinModule;
  if (typeof getBuiltinModule !== 'function') return null;
  try {
    const nodeUtil = getBuiltinModule('node:util') as {
      types?: { isProxy?: (value: unknown) => boolean };
    };
    const isProxy = nodeUtil.types?.isProxy;
    return typeof isProxy === 'function' ? (value) => isProxy(value) : null;
  } catch {
    return null;
  }
}
