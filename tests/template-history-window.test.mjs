import test from 'node:test'
import assert from 'node:assert/strict'

import {spawn} from 'node:child_process'
import {serveTemplateHistoryPipe} from '../tavern-plugin/lib/domain/template-history-pipe.js'
test('isolated worker can synchronously read a framed historical response while host remains asynchronous',async()=>{
 const url=new URL('../tavern-plugin/lib/domain/template-history-pipe.js',import.meta.url).href
 const child=spawn(process.execPath,['--input-type=module','-e',`import {createTemplateHistoryPipeClient} from ${JSON.stringify(url)};const read=createTemplateHistoryPipeClient();process.stdout.write(JSON.stringify(read({messageId:7,token:'g'})));`],{stdio:['ignore','pipe','pipe','ignore','pipe']})
 let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b)
 serveTemplateHistoryPipe(child.stdio[4],async args=>{assert.deepEqual(args,{messageId:7,token:'g'});await new Promise(r=>setTimeout(r,10));return {message:'x'.repeat(100000)}})
 const code=await new Promise(resolve=>child.once('exit',resolve));assert.equal(code,0,error)
 assert.equal(JSON.parse(output).message.length,100000)
})
