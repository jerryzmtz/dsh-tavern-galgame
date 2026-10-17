import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

const source = await readFile(new URL('../src/client.js',import.meta.url),'utf8')

// private fork: exactly one control row remains visible even before configuration.
test('basic panel shows one engine and advanced contains service launch settings', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  const previous = {window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})
  const root = createRoot(document.getElementById('root')), exports = {}, calls = []
  let service
  const fetch = async (_,options) => {const {method} = JSON.parse(options.body);calls.push(method);return {ok:true,json:async () => method === 'settings' ? {installationId:'default',modelConfigPath:'C:/service.json',autoStart:true} : {state:'ready',voiceCount:3,adopted:true}}}
  vm.runInNewContext(source,{exports,require:() => React,fetch,setInterval,clearInterval})
  exports.apply({provide(_,value) {service=value},effect:() => {},slots:{inject:() => {}}})
  try {
    await act(async () => root.render(React.createElement(service.Panel,{mode:'basic'})))
    assert.equal(document.querySelectorAll('h3').length,1)
    assert.match(document.body.textContent,/本地引擎.*运行中 · 3 个音色/)
    // private fork (voice settings r3): one status line and one action that fits the state; 重启 lives in ⋯.
    assert.deepEqual([...document.querySelectorAll('.dtts-line-actions > button')].map(b => b.textContent),['停止'])
    assert.ok(document.querySelector('[aria-label="本地引擎 更多操作"]'))
    assert.equal([...document.querySelectorAll('button')].some(b => ['启动','重启'].includes(b.textContent)),false)
    assert.doesNotMatch(document.body.textContent,/按需待机/)
    assert.equal(document.querySelectorAll('input').length,0)
    await act(async () => root.render(React.createElement(service.Panel,{mode:'advanced'})))
    assert.ok(document.querySelector('input[name="modelConfigPath"]'))
    assert.ok(document.querySelector('input[name="environment"]'))
    assert.equal(calls.some(method => ['start','stop','restart'].includes(method)),false)
  } finally {await act(async () => root.unmount());dom.window.close();Object.assign(globalThis,previous)}
})
