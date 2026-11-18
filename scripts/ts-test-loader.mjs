/**
 * 让 `node --test` 能直接跑 src 里的 .ts 用例。
 *
 * 源码按打包约定写 `import './x.js'`（编译产物是 .js），Node 的类型剥离不会把 .js
 * 还原成 .ts，所以解析时把存在的同名 .ts 顶上去。只影响测试，不影响打包。
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const resolve = async (specifier, context, next) => {
  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    const target = fileURLToPath(new URL(specifier, context.parentURL)).replace(/\.js$/, '.ts')
    if (existsSync(target)) {
      return next(specifier.replace(/\.js$/, '.ts'), context)
    }
  }
  return next(specifier, context)
}
