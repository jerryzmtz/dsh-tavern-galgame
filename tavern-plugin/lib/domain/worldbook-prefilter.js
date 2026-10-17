/** One post-reply worldbook prefilter per chat; a new send cancels it instead of waiting. */
export function createWorldbookPrefilter({ run, logger = console }) {
  const jobs = new Map()
  let disposed = false

  function start(chatId) {
    if (disposed || !chatId) return Promise.resolve()
    const previous = jobs.get(chatId)
    previous?.controller.abort()
    const job = { controller: new AbortController(), promise: null }
    job.promise = Promise.resolve(previous?.promise).catch(() => {}).then(async () => {
      job.controller.signal.throwIfAborted()
      await run(chatId, job.controller.signal)
    }).catch(error => {
      if (!job.controller.signal.aborted) logger.warn('dsh-tavern: 世界书预筛失败，下一轮按关键词与预算注入:', String(error?.message || error))
    }).finally(() => { if (jobs.get(chatId) === job) jobs.delete(chatId) })
    jobs.set(chatId, job)
    return job.promise
  }

  async function cancel(chatId) {
    const job = jobs.get(chatId)
    if (!job) return false
    job.controller.abort()
    await job.promise
    return true
  }

  function dispose() {
    disposed = true
    for (const job of jobs.values()) job.controller.abort()
    jobs.clear()
  }

  return Object.freeze({ start, cancel, dispose })
}
