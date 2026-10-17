import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
const context = vm.createContext({TextDecoder, Uint8Array, bytesToBase64: bytes => Buffer.from(bytes).toString('base64')});
vm.runInContext(await readFile(new URL('../tavern-plugin/src/client/text-resource-file.js',import.meta.url),'utf8'),context);
const parse = (bytes,name='story.txt') => context.parseTextResourceFile({name, arrayBuffer: async()=>Uint8Array.from(bytes).buffer});

test('invalid or explicitly corrupt text is rejected instead of replaced',async()=>{
  for(const bytes of [[0xff],[0xef,0xbb,0xbf,0xff],[0xff,0xfe,0x00],[0xff,0xfe,0,0,65,0,0,0],[65,0,66,0]]) await assert.rejects(parse(bytes),/UTF-8/);
});
