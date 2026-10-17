// Enabled only by the isolated performance scenario, never by the product.
import { register } from 'node:module'
register('./settlement-perf-loader.mjs', import.meta.url)
