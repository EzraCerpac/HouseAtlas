import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const virtualId = 'virtual:houseatlas-pdfjs-resources';
const resolvedId = '\0' + virtualId;

function files(directory, extensions) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && extensions.some(extension => entry.name.endsWith(extension)))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function pdfjsBinaryDataPlugin(frontendRoot) {
  const packageRoot = resolve(frontendRoot, 'node_modules/pdfjs-dist');
  return {
    name: 'houseatlas-pdfjs-binary-data',
    resolveId(id) { return id === virtualId ? resolvedId : null; },
    load(id) {
      if (id !== resolvedId) return null;
      const resources = {};
      for (const [kind, directory, extensions] of [
        ['cMapUrl', 'cmaps', ['.bcmap']],
        ['standardFontDataUrl', 'standard_fonts', ['.pfb', '.ttf']],
        ['wasmUrl', 'wasm', ['openjpeg.wasm', 'jbig2.wasm']],
      ]) {
        for (const entry of files(join(packageRoot, directory), extensions)) {
          resources[kind + '/' + entry.name] = readFileSync(join(packageRoot, directory, entry.name)).toString('base64');
        }
      }
      const fallbackRefs = ['openjpeg_nowasm_fallback.js', 'jbig2_nowasm_fallback.js'].map(filename =>
        this.emitFile({ type: 'asset', fileName: 'assets/pdfjs/' + filename,
          source: readFileSync(join(packageRoot, 'wasm', filename)) }));
      return `const resources=${JSON.stringify(resources)};
const openjpegUrl=import.meta.ROLLUP_FILE_URL_${fallbackRefs[0]};
const jbig2Url=import.meta.ROLLUP_FILE_URL_${fallbackRefs[1]};
export const pdfjsDecoderUrl=new URL('./',new URL(openjpegUrl,document.baseURI)).href;
if(new URL('./',new URL(jbig2Url,document.baseURI)).href!==pdfjsDecoderUrl) throw new Error('PDF.js decoder resources unavailable');
export class HouseAtlasPdfBinaryDataFactory {
  async fetch({kind,filename}) {
    const encoded=resources[kind+'/'+filename];
    if(!encoded) throw new Error('PDF.js resource unavailable');
    return Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));
  }
}`;
    },
  };
}
