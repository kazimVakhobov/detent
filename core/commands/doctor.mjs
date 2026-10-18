// detent doctor — whether this product is in the shape detent expects.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { FAIL, INFO, LOOK, diagnose } from '../doctor.mjs'
import { queueOf, readConfig } from '../product.mjs'
import { scanProduct } from '../scan.mjs'
import { QUEUE } from '../task.mjs'
import { UsageError } from './usage.mjs'

export const options = {}
export const needsProduct = false

const MARK = { ok: '✓', fail: '✗', look: '!', info: '·' }

export function run(dir) {
  const root = resolve(dir)
  if (!existsSync(root)) throw new UsageError(`${root} does not exist`)
  // The scan is told where the queue is so that it does not take it for a
  // repository of the product (ADR 0012); a `queue` it cannot use leaves the
  // scan looking at the default, and diagnose reports the value itself.
  const report = diagnose(root, scanProduct(root, { queue: queueOf(readConfig(root).raw) ?? QUEUE }))

  const print = (checks, indent) => {
    for (const c of checks) {
      const tag = c.condition ? `${c.condition}` : ' '
      process.stdout.write(`${indent}${MARK[c.status]} ${tag.padStart(1)}  ${c.text}\n`)
      if (c.fix) process.stdout.write(`${indent}      → ${c.fix}\n`)
    }
  }

  process.stdout.write(`${root}\n`)
  print(report.product, '  ')
  for (const [name, checks] of Object.entries(report.repos)) {
    process.stdout.write(`\n${name}\n`)
    print(checks, '  ')
  }

  const all = [report.product, ...Object.values(report.repos)].flat()
  const count = (status) => all.filter((c) => c.status === status).length
  const fails = count(FAIL)
  const looks = count(LOOK)
  process.stdout.write(
    `\n${fails === 0 ? 'ready' : `${fails} to change`}${looks ? `, ${looks} worth a look` : ''}${count(INFO) ? `, ${count(INFO)} not checkable` : ''}\n`,
  )
  return fails === 0 ? 0 : 1
}
