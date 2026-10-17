// private fork: dev-side injection identical to tools/dsh-assets/review-data.mjs renderReview().
// The CLI owns production generation; this exists for previews and tests only.
import {readFile, writeFile} from 'node:fs/promises'

export const TEMPLATE = new URL('../../viewer/template.html', import.meta.url)
export const PLACEHOLDER = '__DSH_REVIEW_DATA__'

export function injectReviewData(template, data) {
  if (template.split(PLACEHOLDER).length !== 2) throw new Error('Viewer template must contain exactly one data placeholder')
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return template.replace(PLACEHOLDER, () => json)
}

export async function writeViewer(data, file) {
  const html = injectReviewData(await readFile(TEMPLATE, 'utf8'), data)
  await writeFile(file, html)
  return file
}
