#!/usr/bin/env node
// Rebuilds editor/vendor/occt/occt-import-js.js from the original occt-import-js 0.0.23 file (licenses/original/).
//
// Why: Orca's plugin frames forbid dynamic code evaluation ('unsafe-eval'; only 'wasm-unsafe-eval' is allowed). The
// Emscripten "embind" glue of occt-import-js builds wrapper functions with `new Function(...)` in two places
// (craftInvokerFunction and __emval_get_method_caller). This patch replaces both with equivalent closures that do exactly
// what the generated functions do, so no string is ever evaluated. The WebAssembly file
// (occt-import-js.wasm) is NOT touched. The patched file stays LGPL-2.1 (see THIRD_PARTY_NOTICES.md).
//
//   node dev/patch-occt.mjs          writes the patched file;   node dev/patch-occt.mjs --check   verifies it is up to date
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'licenses', 'original', 'occt-import-js-0.0.23.js')
const out = join(root, 'editor', 'vendor', 'occt', 'occt-import-js.js')

export const BANNER =
  '/* occt-import-js 0.0.23 (LGPL-2.1), modified: embind no longer calls the Function constructor (two places; Orca forbids unsafe-eval).\n' +
  '   Rebuilt from licenses/original/occt-import-js-0.0.23.js by dev/patch-occt.mjs. The .wasm file is unmodified. */\n'

const OLD = 'let[args,invokerFnBody]=createJsInvoker(argTypes,isClassMethodFunc,returns,isAsync);args.push(invokerFnBody);var invokerFn=newFunc(Function,args)(...closureArgs);return createNamedFunction(humanName,invokerFn)'
// Same behaviour as the generated function of createJsInvoker: wire `this` and each argument, call the C++ invoker with
// (target, this?, args...), release temporaries (a destructor stack, or each type's destructorFunction), unwire the result.
const NEW =
  'var invokerFn=function(...jsArgs){var argCount_=argTypes.length-2;var destructors=needsDestructorStack?[]:null;var wired=[cppTargetFunc];var thisWired;' +
  'if(isClassMethodFunc){thisWired=argTypes[1]["toWireType"](destructors,this);wired.push(thisWired)}' +
  'var argWired=[];for(var k=0;k<argCount_;++k){argWired[k]=argTypes[k+2]["toWireType"](destructors,jsArgs[k]);wired.push(argWired[k])}' +
  'var rv=cppInvokerFunc(...wired);' +
  'if(needsDestructorStack){runDestructors(destructors)}else{for(var k=isClassMethodFunc?1:2;k<argTypes.length;++k){var w=k===1?thisWired:argWired[k-2];if(argTypes[k].destructorFunction!==null){argTypes[k].destructorFunction(w)}}}' +
  'if(returns){return argTypes[0]["fromWireType"](rv)}};return createNamedFunction(humanName,invokerFn)'

// The second place: embind's emval method callers (val::call / val::new_), generated the same way.
const OLD2 = 'params.push(functionBody);var invokerFunction=newFunc(Function,params)(...args);'
const NEW2 =
  'var invokerFunction=function(obj,func,destructorsRef,ptr){var vals=[];var offset=0;' +
  'for(var k=0;k<argCount;++k){vals.push(types[k].readValueFromPointer(ptr+offset));offset+=types[k].argPackAdvance}' +
  'var callArgs=kind===0?[obj,...vals]:vals;var rv=kind===1?new func(...callArgs):func.call(...callArgs);' +
  'if(!retType.isVoid){return emval_returnValue(retType,destructorsRef,rv)}};'

function once(text, old, neu) {
  const i = text.indexOf(old)
  if (i < 0 || text.indexOf(old, i + 1) >= 0) throw new Error('the expected code is not (exactly once) in the original file: ' + old.slice(0, 60))
  return text.replace(old, () => neu)
}

export function patch(original) {
  return BANNER + once(once(original, OLD, NEW), OLD2, NEW2)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const patched = patch(readFileSync(src, 'utf8'))
  if (process.argv.includes('--check')) {
    const same = readFileSync(out, 'utf8') === patched
    console.log(same ? 'up to date' : 'OUT OF DATE: run node dev/patch-occt.mjs')
    process.exit(same ? 0 : 1)
  }
  writeFileSync(out, patched)
  console.log('wrote', out)
}
