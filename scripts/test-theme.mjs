import './register-typescript.mjs'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const disk = new Map([['schedule-must-not-change','saved schedule']])
globalThis.localStorage = { getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value) }
globalThis.document = {documentElement:{dataset:{}}}
globalThis.window = new EventTarget()
const { loadTheme, currentTheme, applyTheme, subscribeTheme, THEME_STORAGE_KEY } = await import('../frontend/src/storage/themeStorage.ts')
const { ThemeToggle } = await import('../frontend/src/ui/app/ThemeToggle.tsx')
assert.equal(loadTheme(),'dark')
disk.set(THEME_STORAGE_KEY,'invalid')
assert.equal(loadTheme(),'dark')
let changes = 0
const unsubscribe = subscribeTheme(()=>changes++)
applyTheme('light')
assert.equal(currentTheme(),'light')
assert.equal(loadTheme(),'light','Preference survives reinitialization')
assert.equal(changes,1)
applyTheme(loadTheme())
assert.equal(document.documentElement.dataset.theme,'light')
applyTheme('dark')
assert.equal(changes,3)
assert.equal(currentTheme(),'dark')
unsubscribe()
applyTheme('light')
assert.equal(changes,3)
assert.equal(disk.get('schedule-must-not-change'),'saved schedule')
const originalStorage = globalThis.localStorage
globalThis.localStorage = {getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}}
assert.equal(loadTheme(),'dark')
applyTheme('light')
assert.equal(currentTheme(),'light','Theme works even when saving the preference is unavailable')
globalThis.localStorage = originalStorage
const markup=renderToStaticMarkup(React.createElement(ThemeToggle))
assert.ok(markup.includes('Switch to light mode') && markup.includes('type="button"') && markup.includes('aria-hidden="true"'))
const css=readFileSync('frontend/src/ui/app/theme.css','utf8')
const root=css.slice(css.indexOf(':root {'),css.indexOf(":root[data-theme='light']"))
const light=css.slice(css.indexOf(":root[data-theme='light']"),css.indexOf('.theme-toggle {'))
const palette=text=>Object.fromEntries([...text.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map(m=>[m[1],m[2]]))
const luminance=color=>{
  const rgb=color.slice(1).match(/../g).map(n=>parseInt(n,16)/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4)
  return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722
}
const pairs=[['text-h','surface-page'],['text-main','surface-panel'],['text','surface-raised'],['text-muted','surface-page'],
  ['text-accent','surface-panel'],['blue-text','blue-surface'],['purple-text','purple-card'],['teal-text','teal-card'],
  ['amber-text','amber-duty'],['reliever-text','reliever-surface'],['red-on-surface','red-surface-strong']]
for(const [mode,values] of [['dark',palette(root)],['light',palette(light)]]) {
  for(const [fg,bg] of pairs){
    const levels=[luminance(values[fg]),luminance(values[bg])].sort((a,b)=>b-a)
    assert.ok((levels[0]+0.05)/(levels[1]+0.05)>=4.5, `${mode}: insufficient contrast for ${fg}/${bg}`)
  }
}
const declared=new Set([...css.matchAll(/--([\w-]+):/g)].map(m=>m[1]))
for(const file of readdirSync('frontend/src/ui',{recursive:true}).filter(file=>file.endsWith('.css'))){
  const source=readFileSync(`frontend/src/ui/${file}`,'utf8')
  for(const token of source.matchAll(/var\(--([\w-]+)\)/g)){
    if(/^(surface|text|border|blue|red|green|purple|teal|amber|reliever|duty|block-label|focus|bg|code-bg)/.test(token[1]))
      assert.ok(declared.has(token[1]),`Undefined palette token ${token[1]} in ${file}`)
  }
}
console.log('Theme checks passed: default, persistence, invalid/blocked storage, subscriptions, accessible control, palette coverage, and text/card contrast in both modes.')
