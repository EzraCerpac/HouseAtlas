// Deterministic typed names only. Native validation never invokes this tool.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const catalog = JSON.parse(readFileSync(new URL('../../../../contracts/stock-wire3/agent/operation-catalog.json', import.meta.url), 'utf8'));
const families = JSON.parse(readFileSync(new URL('../../../../contracts/stock-wire3/agent/tool-families.json', import.meta.url), 'utf8'));
const variant = value => value.split(/[._-]/u).map(part => part[0].toUpperCase() + part.slice(1)).join('');
const enumSource = (name, wires) => {
  if (new Set(wires).size !== wires.length || new Set(wires.map(variant)).size !== wires.length) {
    throw new Error(`duplicate ${name} wire or Rust variant`);
  }
  return `wire_enum!(${name} {\n${wires.map(wire => `    ${variant(wire)} => ${JSON.stringify(wire)},`).join('\n')}\n});\n`;
};
const output = '// Generated from adopted stock.2 operation catalog and tool families.\n'
  + '// Regenerate: node backend/src/contracts/stock/generate-catalog.mjs\n\n'
  + enumSource('OperationId', catalog.commands.map(command => command.commandId)) + '\n'
  + enumSource('ToolFamily', families.families.map(family => family.toolName));
const path = fileURLToPath(new URL('./catalog-generated.rs', import.meta.url));
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== output) throw new Error('stock catalog typed IDs are stale');
  console.log(`stock catalog typed IDs match: ${catalog.commands.length} operations, ${families.families.length} families`);
} else {
  writeFileSync(path, output);
}
