import { generateClientSchemas } from '../../tools/client-schemas/generate.mjs';

/** Generate and compare before Vite resolves JSON imports. Updating checked-in
 * artifacts is deliberate; a build refuses drift instead of silently hiding it. */
export function clientSchemasPlugin() {
  generateClientSchemas({ check: true });
  return { name: 'houseatlas-client-schemas' };
}
