import {productionError} from '../../tavern-plugin/lib/domain/asset-production-project.js'
// A delta may include multiple authoring steps since its expected base version.
export function assertDeltaVersion(row) {
  if(!Number.isInteger(row.expected_version)||row.expected_version<0||!Number.isInteger(row.value?.version)||row.value.version<=row.expected_version)
    throw productionError('CONFLICT','Invalid delta version transition for '+row.slot+': value.version must be an integer newer than expected_version; regenerate the delta from its historical base')
}
