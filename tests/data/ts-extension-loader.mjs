/**
 * Test-only compatibility loader for the application's bundler-style imports.
 * Production modules intentionally omit `.ts`; native Node ESM does not resolve
 * those specifiers when the regression tests execute source files directly.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if ((specifier.startsWith(".") || specifier.startsWith("/")) && !/\.[a-z0-9]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
